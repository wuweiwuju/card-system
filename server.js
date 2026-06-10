const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const https = require('https');
const http = require('http');
const FormData = require('form-data');
const iconv = require('iconv-lite');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const LOGIN_API_BASE = process.env.LOGIN_API_BASE || 'https://drive-connect-enhanced-fantasy.trycloudflare.com';
const LOGIN_API_URL  = `${LOGIN_API_BASE}/api/v1/login`;

// ── 卡类型配置（可通过管理后台修改，持久化存储）──────────────
const DEFAULT_CARD_CONFIG = {
  monthly:  { name: '月卡',      days: 28,  scanLimit: 4,  deviceLimit: 1 },
  seasonal: { name: '季卡',      days: 90,  scanLimit: 6,  deviceLimit: 2 },
  yearly:   { name: '年卡',      days: 365, scanLimit: 12, deviceLimit: 2 },
  nba:      { name: 'NBA赛季卡', days: 210, scanLimit: 6,  deviceLimit: 2 },
  f1:       { name: 'F1赛季卡',  days: 180, scanLimit: 6,  deviceLimit: 2 },
};
let cardConfig = { ...DEFAULT_CARD_CONFIG };

// 配置持久化（PG 用 app_config 表，本地用 config.json）
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

async function loadCardConfig() {
  try {
    if (pool) {
      await pool.query(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
      const { rows } = await pool.query(`SELECT value FROM app_config WHERE key='card_config'`);
      if (rows.length) { cardConfig = rows[0].value; console.log('[CONFIG] 已从数据库加载套餐配置'); return; }
    } else if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (saved.cardConfig) { cardConfig = saved.cardConfig; console.log('[CONFIG] 已从文件加载套餐配置'); return; }
    }
  } catch (e) { console.error('[CONFIG] 加载配置失败，使用默认值', e.message); }
}

async function saveCardConfig() {
  try {
    if (pool) {
      await pool.query(
        `INSERT INTO app_config (key, value) VALUES ('card_config', $1)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [JSON.stringify(cardConfig)]
      );
    } else {
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ cardConfig }, null, 2));
    }
  } catch (e) { console.error('[CONFIG] 保存配置失败', e.message); }
}

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
      card_type TEXT NOT NULL DEFAULT 'monthly',
      bound_ip TEXT,
      bound_device TEXT,
      bound_device_type TEXT,
      bound_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'unused',
      last_qr_scan JSONB,
      scan_limit INT NOT NULL DEFAULT 4,
      scan_used INT NOT NULL DEFAULT 0,
      device_limit INT NOT NULL DEFAULT 1
    )
  `).then(async () => {
    await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS bound_device TEXT`).catch(()=>{});
    await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_type TEXT NOT NULL DEFAULT 'monthly'`).catch(()=>{});
    await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS bound_device_type TEXT`).catch(()=>{});
    await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS scan_limit INT NOT NULL DEFAULT 4`).catch(()=>{});
    await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS scan_used INT NOT NULL DEFAULT 0`).catch(()=>{});
    await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS device_limit INT NOT NULL DEFAULT 1`).catch(()=>{});
    console.log('PostgreSQL 已连接');
    await loadCardConfig();
  }).catch(e => console.error('DB 初始化失败', e));
} else {
  console.log('未检测到 DATABASE_URL，使用本地 JSON 存储');
  loadCardConfig();
}

// ── JSON 降级存储 ─────────────────────────────────────────
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
      INSERT INTO cards (token,created_at,expires_at,days,card_type,bound_ip,bound_device,bound_device_type,bound_at,status,last_qr_scan,scan_limit,scan_used,device_limit)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (token) DO UPDATE SET
        expires_at=$3, days=$4, card_type=$5, bound_ip=$6, bound_device=$7, bound_device_type=$8,
        bound_at=$9, status=$10, last_qr_scan=$11, scan_limit=$12, scan_used=$13, device_limit=$14
    `, [card.token, card.createdAt, card.expiresAt, card.days,
        card.cardType || 'monthly', card.boundIp, card.boundDevice,
        card.boundDeviceType, card.boundAt, card.status,
        card.lastQrScan ? JSON.stringify(card.lastQrScan) : null,
        card.scanLimit ?? 4, card.scanUsed ?? 0, card.deviceLimit ?? 1]);
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
  const toISO = v => v ? new Date(v).toISOString() : null;
  return {
    token: row.token,
    createdAt: toISO(row.created_at),
    expiresAt: toISO(row.expires_at),
    days: row.days,
    cardType: row.card_type || 'monthly',
    boundIp: row.bound_ip,
    boundDevice: row.bound_device,
    boundDeviceType: row.bound_device_type,
    boundAt: toISO(row.bound_at),
    status: row.status,
    lastQrScan: row.last_qr_scan,
    scanLimit: row.scan_limit ?? 4,
    scanUsed: row.scan_used ?? 0,
    deviceLimit: row.device_limit ?? 1,
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

// ── 智能解码（优先 UTF-8，乱码则降级 GBK）────────────────────
function decodeBuf(buf, contentType = '') {
  // Content-Type 明确指定编码
  if (/gbk|gb2312|gb18030/i.test(contentType)) {
    return iconv.decode(buf, 'gbk');
  }
  const utf8 = buf.toString('utf-8');
  // U+FFFD = 无效UTF-8字节替换符；U+9FDF(锟) = GBK当UTF-8解析的经典乱码特征
  if (utf8.includes('�') || utf8.includes('鿟')) {
    try { return iconv.decode(buf, 'gbk'); } catch(e) {}
  }
  return utf8;
}

// ── 用户 API ──────────────────────────────────────────────

app.get('/api/activate', async (req, res) => {
  const { token, deviceId } = req.query;
  if (!token) return res.json({ code: 400, msg: '请提供 token' });
  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    if (isExpired(card)) { card.status = 'expired'; await dbSaveCard(card); }
    const currentIp = getClientIp(req);
    const notBound = !card.boundDevice && !card.boundIp;
    const deviceMatch = deviceId && card.boundDevice === deviceId;
    const ipMatch = card.boundIp && card.boundIp === currentIp;
    const isOwner = notBound || deviceMatch || ipMatch;
    const cfg = cardConfig[card.cardType] || cardConfig.monthly;
    res.json({ code: 200, data: {
      token: card.token, status: card.status, expiresAt: card.expiresAt,
      boundDevice: card.boundDevice ? '已绑定' : null,
      boundDeviceType: card.boundDeviceType || null,
      boundAt: card.boundAt || null, isOwner,
      scanUsed: card.scanUsed ?? 0, scanLimit: card.scanLimit ?? cfg.scanLimit,
      cardType: card.cardType || 'monthly',
      cardTypeName: cfg.name,
      deviceLimit: card.deviceLimit ?? cfg.deviceLimit,
    } });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

app.post('/api/activate', async (req, res) => {
  const { token, deviceId } = req.body;
  if (!token) return res.json({ code: 400, msg: '请提供 token' });
  if (!deviceId) return res.json({ code: 400, msg: '请提供 deviceId' });
  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    if (isExpired(card)) { card.status = 'expired'; await dbSaveCard(card); }
    if (card.status === 'expired') return res.json({ code: 403, msg: '卡密已过期' });
    if (card.status === 'disabled') return res.json({ code: 403, msg: '卡密已被禁用' });
    const currentIp = getClientIp(req);
    const deviceMatch = deviceId && card.boundDevice === deviceId;
    const ipMatch = card.boundIp && card.boundIp === currentIp;
    if (card.status === 'active' && (card.boundDevice || card.boundIp) && !deviceMatch && !ipMatch)
      return res.json({ code: 403, msg: '该卡密已绑定其他设备，请联系客服解绑' });
    card.status = 'active';
    if (deviceId) card.boundDevice = deviceId;
    card.boundIp = currentIp;
    card.boundAt = card.boundAt || new Date().toISOString();
    await dbSaveCard(card);
    res.json({ code: 200, msg: '激活成功', data: { expiresAt: card.expiresAt } });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

app.post('/api/unbind', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.json({ code: 400, msg: '请提供 token' });
  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    card.boundDevice = null;
    card.boundIp = null;
    card.boundAt = null;
    if (card.status === 'active') card.status = 'unused';
    await dbSaveCard(card);
    res.json({ code: 200, msg: '已解除绑定' });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

// 调用登录 API（异步，轮询直到完成）
async function callLoginApi(imageBuffer, mimetype, filename, cardToken) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('key', cardToken);
    form.append('image', imageBuffer, { filename: filename || 'qr.png', contentType: mimetype || 'image/png' });

    const urlObj = new URL(LOGIN_API_URL);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: { ...form.getHeaders() },
      timeout: 60000, // 60秒超时
    };

    console.log(`[LOGIN] 提交二维码到 ${LOGIN_API_URL}`);
    const req = lib.request(options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = decodeBuf(buf, res.headers['content-type'] || '');
        console.log(`[LOGIN] 提交响应 status=${res.statusCode} body=${text}`);
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (e) { resolve({ status: res.statusCode, body: text }); }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      console.error('[LOGIN] 提交超时（60s）');
      reject(new Error('LOGIN_TIMEOUT'));
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
          headers: {},
          timeout: 10000, // 10秒超时
        }, res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            const text = decodeBuf(buf, res.headers['content-type'] || '');
            try { resolve(JSON.parse(text)); }
            catch(e) { resolve({ status: 'error', raw: text }); }
          });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('POLL_TIMEOUT')); });
        req.on('error', reject);
        req.end();
      });

      console.log(`[POLL] 第${i+1}次 status=${result.status} msg=${result.message || ''}`);

      const doneStatuses = ['success', 'failed', 'error', 'cancelled', 'timeout'];
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
  const deviceType = req.body.deviceType || 'phone'; // phone/pc/tv/tablet
  if (!token) return res.json({ code: 400, msg: '请提供 token' });

  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    if (card.status !== 'active') return res.json({ code: 403, msg: '请先激活卡密' });

    // 检查扫码次数限制
    const used = card.scanUsed ?? 0;
    const limit = card.scanLimit ?? 4;
    if (used >= limit) {
      return res.json({ code: 403, msg: `扫码次数已用完（${used}/${limit}），请联系客服增加次数`, data: { scanUsed: used, scanLimit: limit } });
    }

    // 检查设备类型限制（首次登录成功后锁定端口类型）
    const deviceTypeMap = { phone: '手机', pc: '电脑', tv: '电视', tablet: '平板' };
    if (card.boundDeviceType && card.boundDeviceType !== deviceType) {
      return res.json({ code: 403, msg: `此卡密只能在${deviceTypeMap[card.boundDeviceType] || card.boundDeviceType}端使用，当前设备类型不符`, data: { boundDeviceType: card.boundDeviceType } });
    }

    // 支持两种方式：上传图片文件 或 传二维码文字内容
    if (req.file) {
      // 有图片文件 → 调登录 API
      const result = await callLoginApi(req.file.buffer, req.file.mimetype, req.file.originalname, token);

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
          if (finalResult.status === 'success') {
            card.scanUsed = (card.scanUsed ?? 0) + 1;
            // 首次登录成功时记录设备类型
            if (!card.boundDeviceType) card.boundDeviceType = deviceType;
            console.log(`[TASK] 登录成功，设备类型=${deviceType}，扫码次数 ${card.scanUsed}/${card.scanLimit}`);
          }
          card.lastQrScan = { type: 'image', taskId: submitResult.taskId, status: finalResult.status, result: finalResult, deviceType, scannedAt: new Date().toISOString() };
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
    const { page = 1, limit = 50, search = '', today = '', status = '', cardType = '' } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));

    let list = await dbListCards();
    // 过期检查
    for (const card of list) {
      if (isExpired(card)) { card.status = 'expired'; await dbSaveCard(card); }
    }
    // 搜索过滤
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.token.toLowerCase().includes(q) || (c.boundIp && c.boundIp.includes(q)));
    }
    // 今日过滤
    if (today === '1') {
      const todayStr = new Date().toISOString().slice(0, 10);
      list = list.filter(c => c.createdAt && c.createdAt.slice(0, 10) === todayStr);
    }
    // 状态过滤
    if (status) list = list.filter(c => c.status === status);
    // 卡类型过滤
    if (cardType) list = list.filter(c => c.cardType === cardType);

    const total = list.length;
    const pages = Math.ceil(total / limitNum);
    const data = list.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({ code: 200, data, pagination: { page: pageNum, limit: limitNum, total, pages } });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

app.post('/api/admin/generate', adminAuth, async (req, res) => {
  const { count = 1, cardType = 'monthly' } = req.body;
  if (count < 1 || count > 100) return res.json({ code: 400, msg: 'count 范围 1-100' });
  const cfg = cardConfig[cardType];
  if (!cfg) return res.json({ code: 400, msg: '无效卡类型' });
  try {
    const now = new Date();
    const generated = [];
    for (let i = 0; i < count; i++) {
      const token = generateToken();
      const card = {
        token, createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + cfg.days * 86400000).toISOString(),
        days: cfg.days, cardType,
        boundIp: null, boundDevice: null, boundDeviceType: null, boundAt: null,
        status: 'unused', lastQrScan: null,
        scanLimit: cfg.scanLimit, scanUsed: 0, deviceLimit: cfg.deviceLimit
      };
      await dbSaveCard(card);
      generated.push(token);
    }
    res.json({ code: 200, msg: `成功生成 ${count} 个${cfg.name}（${cfg.days}天，扫码${cfg.scanLimit}次，${cfg.deviceLimit}台设备）`, data: generated });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

// 获取/更新卡类型配置
app.get('/api/admin/card-config', adminAuth, (req, res) => {
  res.json({ code: 200, data: cardConfig });
});

app.put('/api/admin/card-config', adminAuth, async (req, res) => {
  const updates = req.body;
  // 先清空再重建，支持新增和删除
  cardConfig = {};
  for (const type of Object.keys(updates)) {
    const u = updates[type];
    cardConfig[type] = {
      name: u.name || type,
      days: Number(u.days) || 30,
      scanLimit: Number(u.scanLimit) || 4,
      deviceLimit: Number(u.deviceLimit) || 1,
    };
  }
  await saveCardConfig();
  res.json({ code: 200, msg: '配置已更新', data: cardConfig });
});

app.patch('/api/admin/cards/:token', adminAuth, async (req, res) => {
  const { token } = req.params;
  const { action } = req.body;
  try {
    const card = await dbGetCard(token);
    if (!card) return res.json({ code: 404, msg: '卡密不存在' });
    if (action === 'disable') {
      card.status = 'disabled';
    } else if (action === 'enable') {
      card.status = card.boundDevice || card.boundIp ? 'active' : 'unused';
    } else if (action === 'add_scan') {
      const add = parseInt(req.body.value) || 1;
      card.scanLimit = (card.scanLimit ?? 4) + add;
    } else if (action === 'extend') {
      // 延期：在当前到期时间基础上加天数
      const days = parseInt(req.body.value) || 30;
      const base = new Date(card.expiresAt) > new Date() ? new Date(card.expiresAt) : new Date();
      card.expiresAt = new Date(base.getTime() + days * 86400000).toISOString();
      card.days = (card.days || 0) + days;
      if (card.status === 'expired') card.status = card.boundDevice ? 'active' : 'unused';
    } else if (action === 'reset_device') {
      // 一键恢复：清除绑定信息，恢复为未激活
      card.boundDevice = null;
      card.boundDeviceType = null;
      card.boundIp = null;
      card.boundAt = null;
      card.status = 'unused';
    } else {
      return res.json({ code: 400, msg: '未知操作' });
    }
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

// 批量删除
app.post('/api/admin/cards/batch-delete', adminAuth, async (req, res) => {
  const { tokens } = req.body; // string[]
  if (!Array.isArray(tokens) || !tokens.length)
    return res.json({ code: 400, msg: '请提供 tokens 数组' });
  try {
    let count = 0;
    for (const token of tokens) {
      const card = await dbGetCard(token);
      if (card) { await dbDeleteCard(token); count++; }
    }
    res.json({ code: 200, msg: `已删除 ${count} 个卡密` });
  } catch (e) { res.json({ code: 500, msg: '服务器错误' }); }
});

// ── 设备管理 API（转发到自动化服务）──────────────────────────

async function fetchDeviceApi(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(LOGIN_API_BASE + path);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + (urlObj.search || ''),
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000, // 15秒超时
    };
    const req = lib.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = decodeBuf(buf);
        try { resolve(JSON.parse(text)); } catch(e) { resolve({ raw: text }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('DEVICE_API_TIMEOUT')); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// 获取设备列表
app.get('/api/admin/devices', adminAuth, async (req, res) => {
  try {
    const data = await fetchDeviceApi('/api/v1/devices');
    res.json({ code: 200, data });
  } catch (e) {
    res.json({ code: 502, msg: '获取设备列表失败: ' + e.message });
  }
});

// 启用/禁用设备
app.post('/api/admin/devices/:serial/enable', adminAuth, async (req, res) => {
  const { serial } = req.params;
  const { enabled, reason } = req.body;
  if (enabled === undefined) return res.json({ code: 400, msg: '请提供 enabled 参数' });
  try {
    const body = { enabled };
    if (reason) body.reason = reason;
    const data = await fetchDeviceApi(`/api/v1/devices/${serial}/enable`, 'POST', body);
    res.json({ code: 200, data });
  } catch (e) {
    res.json({ code: 502, msg: '操作失败: ' + e.message });
  }
});

// 导出全量数据库备份（JSON）
app.get('/api/admin/backup', adminAuth, async (req, res) => {
  try {
    const cards = await dbListCards();
    const payload = {
      exportedAt: new Date().toISOString(),
      total: cards.length,
      cards,
    };
    const filename = `cards_backup_${new Date().toISOString().slice(0,10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) {
    res.status(500).json({ code: 500, msg: '导出失败: ' + e.message });
  }
});

app.get('/activate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`卡密激活系统运行中: http://localhost:${PORT}`);
  console.log(`管理后台: http://localhost:${PORT}/admin.html`);
});
