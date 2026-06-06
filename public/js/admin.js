let adminKey = '';
let allCards = [];
let cardConfigData = {};

const STATUS_LABEL = {
  unused:   '<span class="badge badge-warn">未激活</span>',
  active:   '<span class="badge badge-ok">已激活</span>',
  expired:  '<span class="badge badge-error">已过期</span>',
  disabled: '<span class="badge" style="background:#f0f0f0;color:#888">已禁用</span>',
};

const CARD_TYPE_LABEL = {
  monthly:  '月卡',
  seasonal: '季卡',
  yearly:   '年卡',
  nba:      'NBA赛季卡',
  f1:       'F1赛季卡',
};

const DEVICE_TYPE_LABEL = {
  phone: '📱 手机',
  pc:    '💻 电脑',
  tv:    '📺 电视',
  tablet:'📟 平板',
};

// ── 登录 ──────────────────────────────────────────────────
function login() {
  adminKey = document.getElementById('admin-key').value.trim();
  if (!adminKey) return;
  Promise.all([fetchCards(), fetchConfig()]).then(([ok]) => {
    if (ok) {
      document.getElementById('login-panel').style.display = 'none';
      document.getElementById('admin-panel').style.display = 'block';
      onCardTypeChange();
    }
  });
}

function logout() {
  adminKey = '';
  allCards = [];
  document.getElementById('admin-panel').style.display = 'none';
  document.getElementById('login-panel').style.display = 'block';
  document.getElementById('admin-key').value = '';
}

// ── Tab 切换 ──────────────────────────────────────────────
function switchTab(tab) {
  const tabs = ['cards', 'config', 'devices'];
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'devices') fetchDevices();
}

// ── 数据 ──────────────────────────────────────────────────
async function fetchCards() {
  try {
    const res = await fetch('/api/admin/cards', { headers: { 'X-Admin-Key': adminKey } });
    const { code, data, msg } = await res.json();
    if (code === 401) { document.getElementById('login-err').textContent = '密码错误'; return false; }
    if (code !== 200) { showToast(msg); return false; }
    allCards = data;
    renderTable();
    return true;
  } catch (e) { showToast('网络错误'); return false; }
}

async function fetchConfig() {
  try {
    const res = await fetch('/api/admin/card-config', { headers: { 'X-Admin-Key': adminKey } });
    const { code, data } = await res.json();
    if (code === 200) { cardConfigData = data; renderConfig(); }
  } catch (e) {}
}

// ── 卡密列表 ──────────────────────────────────────────────
function renderTable() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const filtered = allCards.filter(c =>
    c.token.toLowerCase().includes(q) ||
    (c.boundIp && c.boundIp.includes(q)) ||
    (c.cardType && c.cardType.includes(q))
  );

  document.getElementById('card-count').textContent = `共 ${allCards.length} 个卡密，显示 ${filtered.length} 个`;

  const tbody = document.getElementById('table-body');
  tbody.innerHTML = filtered.map(c => {
    const exp = c.expiresAt ? new Date(c.expiresAt).toLocaleString('zh-CN') : '—';
    const scanInfo = `${c.scanUsed ?? 0}/${c.scanLimit ?? 4}`;
    const scanColor = (c.scanUsed ?? 0) >= (c.scanLimit ?? 4) ? 'color:#e05252;font-weight:700' : 'color:#18a058';
    const devType = c.boundDeviceType ? (DEVICE_TYPE_LABEL[c.boundDeviceType] || c.boundDeviceType) : '—';
    const cardTypeName = CARD_TYPE_LABEL[c.cardType] || c.cardType || '—';
    const toggleBtn = c.status === 'disabled'
      ? `<button class="btn-warn" onclick="toggleCard('${c.token}','enable')">启用</button>`
      : `<button class="btn-warn" onclick="toggleCard('${c.token}','disable')">禁用</button>`;
    return `<tr>
      <td style="font-family:monospace;font-size:12px">${c.token}</td>
      <td style="font-size:13px">${cardTypeName}</td>
      <td>${STATUS_LABEL[c.status] || c.status}</td>
      <td style="font-size:12px">${exp}</td>
      <td style="font-size:13px">${devType}</td>
      <td style="font-size:13px;${scanColor}">${scanInfo}
        <button class="btn-warn" style="padding:3px 8px;font-size:12px;margin-left:4px" onclick="addScan('${c.token}')">+次数</button>
      </td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-primary" style="padding:6px 10px;font-size:12px" onclick="copyToken('${c.token}')">复制</button>
        ${toggleBtn}
        <button class="btn-warn" onclick="resetDevice('${c.token}')">重置设备</button>
        <button class="btn-danger" onclick="deleteCard('${c.token}')">删除</button>
      </td>
    </tr>`;
  }).join('');
}

// ── 套餐配置 ──────────────────────────────────────────────
function renderConfig() {
  const tbody = document.getElementById('config-body');
  if (!tbody) return;
  tbody.innerHTML = Object.entries(cardConfigData).map(([type, cfg]) => `
    <tr>
      <td><strong>${type}</strong></td>
      <td>${cfg.name}</td>
      <td><input type="number" id="cfg-days-${type}" value="${cfg.days}" min="1" max="3650"></td>
      <td><input type="number" id="cfg-scan-${type}" value="${cfg.scanLimit}" min="1" max="999"></td>
      <td><input type="number" id="cfg-device-${type}" value="${cfg.deviceLimit}" min="1" max="10"></td>
    </tr>
  `).join('');
}

async function saveConfig() {
  const updates = {};
  for (const type of Object.keys(cardConfigData)) {
    updates[type] = {
      days: parseInt(document.getElementById(`cfg-days-${type}`)?.value) || cardConfigData[type].days,
      scanLimit: parseInt(document.getElementById(`cfg-scan-${type}`)?.value) || cardConfigData[type].scanLimit,
      deviceLimit: parseInt(document.getElementById(`cfg-device-${type}`)?.value) || cardConfigData[type].deviceLimit,
    };
  }
  try {
    const res = await fetch('/api/admin/card-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify(updates)
    });
    const { code, msg, data } = await res.json();
    if (code === 200) {
      cardConfigData = data;
      document.getElementById('config-result').textContent = '✓ 保存成功';
      setTimeout(() => document.getElementById('config-result').textContent = '', 3000);
      onCardTypeChange();
    } else { showToast(msg); }
  } catch (e) { showToast('保存失败'); }
}

// ── 生成卡密 ──────────────────────────────────────────────
function onCardTypeChange() {
  const type = document.getElementById('gen-card-type')?.value;
  const cfg = cardConfigData[type];
  const info = document.getElementById('gen-type-info');
  if (cfg && info) {
    info.textContent = `${cfg.days}天 · 扫码${cfg.scanLimit}次 · ${cfg.deviceLimit}台设备`;
  }
}

function showGenPanel() {
  const p = document.getElementById('gen-panel');
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
  document.getElementById('gen-result').textContent = '';
  onCardTypeChange();
}

async function generateCards() {
  const count = parseInt(document.getElementById('gen-count').value) || 1;
  const cardType = document.getElementById('gen-card-type').value;
  try {
    const res = await fetch('/api/admin/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ count, cardType })
    });
    const { code, data, msg } = await res.json();
    if (code !== 200) { showToast(msg); return; }
    document.getElementById('gen-result').textContent = `✓ 已生成 ${data.length} 个`;
    await fetchCards();
  } catch (e) { showToast('生成失败'); }
}

// ── 增加扫码次数 ──────────────────────────────────────────
async function addScan(token) {
  const add = prompt('增加几次扫码次数？', '1');
  if (!add || isNaN(add) || parseInt(add) < 1) return;
  try {
    const res = await fetch(`/api/admin/cards/${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ action: 'add_scan', value: parseInt(add) })
    });
    const { code, msg } = await res.json();
    showToast(msg);
    if (code === 200) await fetchCards();
  } catch (e) { showToast('操作失败'); }
}

// ── 一键重置设备 ──────────────────────────────────────────
async function resetDevice(token) {
  if (!confirm('确认重置该卡密的设备绑定信息？用户需重新激活。')) return;
  try {
    const res = await fetch(`/api/admin/cards/${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ action: 'reset_device' })
    });
    const { code, msg } = await res.json();
    showToast(msg);
    if (code === 200) await fetchCards();
  } catch (e) { showToast('操作失败'); }
}

// ── 禁用 / 启用 ───────────────────────────────────────────
async function toggleCard(token, action) {
  try {
    const res = await fetch(`/api/admin/cards/${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ action })
    });
    const { code, msg } = await res.json();
    showToast(msg);
    if (code === 200) await fetchCards();
  } catch (e) { showToast('操作失败'); }
}

// ── 删除 ──────────────────────────────────────────────────
async function deleteCard(token) {
  if (!confirm(`确认删除卡密 ${token}？`)) return;
  try {
    const res = await fetch(`/api/admin/cards/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Key': adminKey }
    });
    const { code, msg } = await res.json();
    showToast(msg);
    if (code === 200) await fetchCards();
  } catch (e) { showToast('删除失败'); }
}

// ── 复制 ──────────────────────────────────────────────────
function copyToken(token) {
  const url = `${location.origin}/activate?token=${token}`;
  navigator.clipboard.writeText(url).then(() => showToast('已复制激活链接'));
}

// ── 导出 CSV ──────────────────────────────────────────────
function exportCSV() {
  const rows = [['卡密', '卡类型', '状态', '到期时间', '绑定IP', '绑定设备类型', '扫码已用', '扫码上限', '设备上限', '绑定时间', '创建时间']];
  allCards.forEach(c => {
    rows.push([c.token, CARD_TYPE_LABEL[c.cardType] || c.cardType || '', c.status,
      c.expiresAt || '', c.boundIp || '', c.boundDeviceType || '',
      c.scanUsed ?? 0, c.scanLimit ?? 4, c.deviceLimit ?? 1, c.boundAt || '', c.createdAt || '']);
  });
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cards_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ── 设备管理 ──────────────────────────────────────────────
async function fetchDevices() {
  const tbody = document.getElementById('devices-body');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#aaa;padding:24px">加载中...</td></tr>';
  try {
    const res = await fetch('/api/admin/devices', { headers: { 'X-Admin-Key': adminKey } });
    const { code, data, msg } = await res.json();
    if (code !== 200) { showToast(msg || '获取失败'); return; }

    const d = data.data || data;
    const stats = document.getElementById('device-stats');
    if (stats && d.total !== undefined) {
      stats.innerHTML = `总设备 <strong>${d.total}</strong> 台 &nbsp;|&nbsp; 在线 <strong style="color:#18a058">${d.online}</strong> &nbsp;|&nbsp; 空闲 <strong style="color:#5b6ef5">${d.idle}</strong> &nbsp;|&nbsp; 忙碌 <strong style="color:#e05252">${d.busy}</strong>`;
    }

    const devices = d.devices || [];
    if (!devices.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#aaa;padding:24px">暂无设备</td></tr>';
      return;
    }

    tbody.innerHTML = devices.map(dev => {
      const statusBadge = dev.status === 'idle'
        ? '<span class="badge badge-ok">空闲</span>'
        : '<span class="badge badge-error">忙碌</span>';
      const onlineBadge = dev.isOnline
        ? '<span style="color:#18a058">● 在线</span>'
        : '<span style="color:#aaa">● 离线</span>';
      const enabledBadge = dev.enabled === false
        ? '<span class="badge badge-error">已禁用</span>'
        : '<span class="badge badge-ok">可用</span>';
      const lastUsed = dev.lastUsed ? new Date(dev.lastUsed).toLocaleString('zh-CN') : '—';
      const currentTask = dev.currentTaskId
        ? `<span style="font-size:11px;font-family:monospace">${dev.currentTaskId.slice(0,12)}...</span>`
        : '—';
      const toggleBtn = dev.enabled === false
        ? `<button class="btn-primary" style="padding:5px 10px;font-size:12px" onclick="setDeviceEnabled('${dev.serial}', true)">启用</button>`
        : `<button class="btn-danger" onclick="setDeviceEnabled('${dev.serial}', false)">禁用</button>`;

      return `<tr>
        <td style="font-family:monospace;font-size:12px">${dev.serial}<br>${onlineBadge}</td>
        <td style="font-size:13px">${dev.model || '—'}</td>
        <td>${statusBadge}<br>${enabledBadge}</td>
        <td style="font-size:12px">${dev.boundPlatform || '—'}</td>
        <td style="font-size:12px">${currentTask}</td>
        <td style="text-align:center">${dev.taskCount ?? 0}</td>
        <td style="font-size:12px">${lastUsed}</td>
        <td>${toggleBtn}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#e05252;padding:24px">连接设备服务失败，请检查接口是否在线</td></tr>';
  }
}

async function setDeviceEnabled(serial, enabled) {
  try {
    const res = await fetch(`/api/admin/devices/${encodeURIComponent(serial)}/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ enabled })
    });
    const { code, msg } = await res.json();
    showToast(code === 200 ? (enabled ? '设备已启用' : '设备已禁用') : (msg || '操作失败'));
    if (code === 200) fetchDevices();
  } catch (e) { showToast('操作失败'); }
}

// ── Toast ──────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}
