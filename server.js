const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const https = require('https');
const http = require('http');
const FormData = require('form-data');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const LOGIN_API_BASE = process.env.LOGIN_API_BASE || 'https://unbounded-hesitant-derby.ngrok-free.dev';
const LOGIN_API_KEY  = process.env.LOGIN_API_KEY  || 'friend-test-key-2026';
const LOGIN_API_URL  = `${LOGIN_API_BASE}/api/v1/login`;

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123456';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DB 初始化 ─────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;

if (DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      token TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      days INT NOT NULL,
      bound_ip TEXT,
      bound_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'unused',
      last_qr_scan JSONB
    )
  `).then(() => console.log('PostgreSQL 已连接')).catch(e => console.error('DB 初始化失败', e));
} else {
  console.log('未检测到 DATABASE_URL，使用本地 JSON 存储');
}

// ── JSON 降级存储 ─────────────────────────────────────────
const fs = require('fs');
const DATA_FILE = path.join(__dirname, 'data', 'cards.json');

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const init = { cards: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── 通用 DB 操作（自动选择 PG 或 JSON）──────────────────────

async function dbGetCard(token) {
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM cards WHERE token=$1', [token]);
    return rows[0] ? pgRowToCard(rows[0]) : null;
  }
  const data = readData();
  return data.cards[token] || null;
}

async function dbSaveCard(card) {
  if (pool) {
    await pool.query(`
      INSERT INTO cards (token,created_at,expires_at,days,bound_ip,bound_at,status,last_qr_scan)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (token) DO UPDATE SET
        expires_at=$3, days=$4, bound_ip=$5, bound_at=$6, status=$7, last_qr_scan=$8
    `, [card.token, card.createdAt, card.expiresAt, card.days,
        card.boundIp, card.boundAt, card.status, card.lastQrScan ? JSON.stringify(card.lastQrScan) : null]);
    return;
  }
  const data = readData();
  data.cards[card.token] = card;
  writeData(data);
}

async function dbDeleteCard(token) {
  if (pool) { await pool.query('DELETE FROM cards WHERE token=$1', [token]); return; }
  const data = readData();
  delete data.cards[token];
  writeData(data);
}

async function dbListCards() {
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM cards ORDER BY created_at DESC');
    return rows.map(pgRowToCard);
  }
  const data = readData();
  return Object.values(data.cards);
}

function pgRowToCard(row) {
  return {
    token: row.token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    days: row.days,
    boundIp: row.bound_ip,
    boundAt: row.bound_at,
    status: row.status,
    lastQrScan: row.last_qr_scan,
  };
}

// ── 工具函数 ──────────────────────────────────────────────
function generateToken() {
  return 'SI' + uuidv4().replace(/-/g, '').toUpperCase().slice(0, 18);
}
function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}
function isExpired(card) {
  return card.status !== 'disabled' && new Date() > new Date(card.expiresAt);
}

// ── 管理员中间件 ──────────────────────────────────────────
function adminAuth(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ code: 401, msg: '无权限' });
  }
  next();
}

// ── 用户 API ──────────────────────────────────────────────

app.get('/api/activate', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ code: 400, msg: '请提供 token' });
  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    if (isExpired(card)) { card.status = 'expired'; await dbSaveCard(card); }
    res.json({ code: 200, data: { token: card.token, status: card.status, expiresAt: card.expiresAt, boundDevice: card.boundIp || null, boundAt: card.boundAt || null } });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

app.post('/api/activate', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.json({ code: 400, msg: '请提供 token' });
  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    if (isExpired(card)) { card.status = 'expired'; await dbSaveCard(card); }
    if (card.status === 'expired') return res.json({ code: 403, msg: '卡密已过期' });
    if (card.status === 'disabled') return res.json({ code: 403, msg: '卡密已被禁用' });
    const ip = getClientIp(req);
    if (card.status === 'active' && card.boundIp && card.boundIp !== ip)
      return res.json({ code: 403, msg: '该卡密已绑定其他设备，请联系客服解绑' });
    card.status = 'active';
    card.boundIp = ip;
    card.boundAt = card.boundAt || new Date().toISOString();
    await dbSaveCard(card);
    res.json({ code: 200, msg: '激活成功', data: { boundIp: ip, expiresAt: card.expiresAt } });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

app.post('/api/unbind', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.json({ code: 400, msg: '请提供 token' });
  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    card.boundIp = null;
    card.boundAt = null;
    if (card.status === 'active') card.status = 'unused';
    await dbSaveCard(card);
    res.json({ code: 200, msg: '已解除绑定' });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

// 调用登录 API（异步，轮询直到完成）
async function callLoginApi(imageBuffer, mimetype, filename) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('key', LOGIN_API_KEY);
    form.append('image', imageBuffer, { filename: filename || 'qr.png', contentType: mimetype || 'image/png' });

    const urlObj = new URL(LOGIN_API_URL);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: { ...form.getHeaders(), 'ngrok-skip-browser-warning': 'true' },
    };

    console.log(`[LOGIN] 提交二维码到 ${LOGIN_API_URL}`);
    const req = lib.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[LOGIN] 提交响应 status=${res.statusCode} body=${data}`);
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', e => {
      console.error('[LOGIN] 提交失败:', e.message);
      reject(e);
    });
    form.pipe(req);
  });
}

// 轮询任务状态
async function pollTask(pollUrl, maxRetry = 30, intervalMs = 3000) {
  const fullPollUrl = pollUrl.startsWith('http') ? pollUrl : `${LOGIN_API_BASE}${pollUrl}`;
  console.log(`[POLL] 开始轮询 ${fullPollUrl} 最多${maxRetry}次 间隔${intervalMs}ms`);

  for (let i = 0; i < maxRetry; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const result = await new Promise((resolve, reject) => {
        const lib = fullPollUrl.startsWith('https') ? https : http;
        const u = new URL(fullPollUrl);
        const req = lib.request({
          hostname: u.hostname, path: u.pathname, method: 'GET',
          headers: { 'ngrok-skip-browser-warning': 'true' }
        }, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch(e) { resolve({ status: 'error', raw: data }); }
          });
        });
        req.on('error', reject);
        req.end();
      });

      console.log(`[POLL] 第${i+1}次 status=${result.status} msg=${result.message || ''}`);

      const doneStatuses = ['success', 'failed', 'error', 'cancelled'];
      if (result.status && doneStatuses.includes(result.status)) {
        console.log(`[POLL] 完成! status=${result.status}`);
        return result;
      }
    } catch(e) {
      console.error(`[POLL] 第${i+1}次请求失败:`, e.message);
    }
  }

  console.warn(`[POLL] 超时，共轮询 ${maxRetry} 次`);
  return { status: 'timeout', message: `等待超时(${maxRetry * intervalMs / 1000}秒)，请稍后查看` };
}

// 上传二维码图片并自动登录
app.post('/api/scan-qr', upload.single('image'), async (req, res) => {
  const token = req.body.token;
  if (!token) return res.json({ code: 400, msg: '请提供 token' });

  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    if (card.status !== 'active') return res.json({ code: 403, msg: '请先激活卡密' });

    // 支持两种方式：上传图片文件 或 传二维码文字内容
    if (req.file) {
      // 有图片文件 → 调登录 API
      const result = await callLoginApi(req.file.buffer, req.file.mimetype, req.file.originalname);

      if (result.status !== 200 && result.status !== 202) {
        const isDown = result.status === 503 || result.status === 502 || result.status === 504;
        return res.json({
          code: 502,
          msg: isDown ? '服务暂时不可用，请稍后重试' : '登录接口返回错误',
          data: result.body
        });
      }

      const submitResult = result.body;
      // 异步任务：返回 taskId 后轮询结果
      if (submitResult.taskId && submitResult.pollUrl) {
        card.lastQrScan = { type: 'image', taskId: submitResult.taskId, status: 'pending', scannedAt: new Date().toISOString() };
        await dbSaveCard(card);

        // 先告诉前端任务已提交，再后台轮询
        res.json({ code: 200, msg: '二维码已提交，正在处理...', data: { taskId: submitResult.taskId, status: 'pending' } });

        // 后台继续轮询
        pollTask(submitResult.pollUrl).then(async finalResult => {
          console.log(`[TASK] ${submitResult.taskId} 最终结果:`, JSON.stringify(finalResult));
          card.lastQrScan = { type: 'image', taskId: submitResult.taskId, status: finalResult.status, result: finalResult, scannedAt: new Date().toISOString() };
          await dbSaveCard(card);
          console.log(`[TASK] 已保存到数据库 status=${finalResult.status}`);
        }).catch(e => console.error('[TASK] 轮询异常:', e.message));
      } else {
        // 同步结果
        card.lastQrScan = { type: 'image', result: submitResult, scannedAt: new Date().toISOString() };
        await dbSaveCard(card);
        return res.json({ code: 200, msg: '登录成功', data: submitResult });
      }
    } else {
      // 无图片 → 纯文字内容记录
      const qrContent = req.body.qrContent;
      if (!qrContent) return res.json({ code: 400, msg: '请上传图片或提供二维码内容' });
      card.lastQrScan = { type: 'text', content: qrContent, scannedAt: new Date().toISOString() };
      await dbSaveCard(card);
      return res.json({ code: 200, msg: '二维码内容已记录', data: { content: qrContent } });
    }
  } catch (e) {
    console.error('scan-qr error:', e);
    res.json({ code: 500, msg: '服务器错误: ' + e.message });
  }
});

// 查询扫码任务状态
app.get('/api/task-status', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ code: 400, msg: '请提供 token' });
  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    res.json({ code: 200, data: card.lastQrScan || null });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

// ── 管理员 API ────────────────────────────────────────────

app.get('/api/admin/cards', adminAuth, async (req, res) => {
  try {
    const list = await dbListCards();
    for (const card of list) {
      if (isExpired(card)) { card.status = 'expired'; await dbSaveCard(card); }
    }
    res.json({ code: 200, data: list });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

app.post('/api/admin/generate', adminAuth, async (req, res) => {
  const { count = 1, days = 30 } = req.body;
  if (count < 1 || count > 100) return res.json({ code: 400, msg: 'count 范围 1-100' });
  try {
    const now = new Date();
    const generated = [];
    for (let i = 0; i < count; i++) {
      const token = generateToken();
      const card = { token, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + days * 86400000).toISOString(), days: Number(days), boundIp: null, boundAt: null, status: 'unused', lastQrScan: null };
      await dbSaveCard(card);
      generated.push(token);
    }
    res.json({ code: 200, msg: `成功生成 ${count} 个卡密`, data: generated });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

app.patch('/api/admin/cards/:token', adminAuth, async (req, res) => {
  const { token } = req.params;
  const { action } = req.body;
  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    if (action === 'disable') card.status = 'disabled';
    else if (action === 'enable') card.status = card.boundIp ? 'active' : 'unused';
    else return res.json({ code: 400, msg: '未知操作' });
    await dbSaveCard(card);
    res.json({ code: 200, msg: '操作成功' });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

app.delete('/api/admin/cards/:token', adminAuth, async (req, res) => {
  const { token } = req.params;
  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    await dbDeleteCard(token);
    res.json({ code: 200, msg: '已删除' });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

app.get('/activate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`卡密激活系统运行中: http://localhost:${PORT}`);
  console.log(`管理后台: http://localhost:${PORT}/admin.html`);
});
