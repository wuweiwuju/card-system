let adminKey = '';
let allCards = [];
let cardConfigData = {};
let currentPage = 1;
const PAGE_SIZE = 50;

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
async function fetchCards(page = 1) {
  currentPage = page;
  try {
    const res = await fetch(`/api/admin/cards?page=${page}&limit=${PAGE_SIZE}`, { headers: { 'X-Admin-Key': adminKey } });
    const json = await res.json();
    if (json.code === 401) { document.getElementById('login-err').textContent = '密码错误'; return false; }
    if (json.code !== 200) { showToast(json.msg); return false; }
    allCards = json.data;
    renderTable(json.pagination);
    return true;
  } catch (e) { showToast('网络错误'); return false; }
}

async function fetchConfig() {
  try {
    const res = await fetch('/api/admin/card-config', { headers: { 'X-Admin-Key': adminKey } });
    const { code, data } = await res.json();
    if (code === 200) { cardConfigData = data; renderConfig(); renderGenTypeOptions(); }
  } catch (e) {}
}

// ── 卡密列表 ──────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isToday(isoStr) {
  if (!isoStr) return false;
  return isoStr.slice(0, 10) === todayStr();
}

function renderTable(pagination = null) {
  const q = document.getElementById('search-input').value.toLowerCase();
  const todayOnly = document.getElementById('filter-today')?.checked;
  const filtered = allCards.filter(c => {
    const matchQ = !q || c.token.toLowerCase().includes(q) ||
      (c.boundIp && c.boundIp.includes(q)) ||
      (c.cardType && c.cardType.includes(q));
    const matchDay = !todayOnly || isToday(c.createdAt);
    return matchQ && matchDay;
  });

  const total = pagination ? pagination.total : allCards.length;
  const pages = pagination ? pagination.pages : 1;
  const page = pagination ? pagination.page : 1;
  document.getElementById('card-count').textContent = `共 ${total} 个卡密，当前第 ${page}/${pages} 页`;

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
    const createdAt = c.createdAt ? new Date(c.createdAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
    const todayMark = isToday(c.createdAt) ? '<span style="background:#dcfce7;color:#16a34a;border-radius:4px;padding:1px 5px;font-size:11px;margin-left:4px">今日</span>' : '';
    const devIcon = devType !== '—' ? devType + ' ' : '';
    return `<tr>
      <td>
        <span style="font-family:monospace;font-size:12px;cursor:pointer" title="点击复制" onclick="copyTokenDirect('${c.token}')">${c.token.slice(0,8)}…${c.token.slice(-4)}</span>
      </td>
      <td>
        <div style="font-size:13px;font-weight:600;color:#444">${cardTypeName}</div>
        <div style="margin-top:3px;display:flex;gap:4px;align-items:center">${STATUS_LABEL[c.status] || c.status}${devIcon ? `<span style="font-size:11px;color:#888">${devIcon}</span>` : ''}</div>
      </td>
      <td style="font-size:12px;color:#555">${exp}</td>
      <td>
        <span style="font-size:13px;font-weight:700;${scanColor}">${scanInfo}</span>
        <button class="btn-warn" style="padding:2px 7px;font-size:11px;margin-left:4px" onclick="addScan('${c.token}')">+</button>
      </td>
      <td style="font-size:12px;color:#888">${createdAt}${todayMark}</td>
      <td style="text-align:right">
        <div style="display:flex;gap:4px;justify-content:flex-end;align-items:center;white-space:nowrap">
          <button class="btn-primary" style="padding:4px 8px;font-size:11px" onclick="copyToken('${c.token}')">复制</button>
          ${toggleBtn}
          <button style="padding:4px 8px;font-size:11px;background:#e0f2fe;color:#0369a1;border:none;border-radius:6px;cursor:pointer" onclick="extendCard('${c.token}')">延期</button>
          <button style="padding:4px 8px;font-size:11px;background:#fff8e7;color:#b45309;border:none;border-radius:6px;cursor:pointer" onclick="resetDevice('${c.token}')">重置</button>
          <button style="padding:4px 8px;font-size:11px;background:#fee2e2;color:#dc2626;border:none;border-radius:6px;cursor:pointer" onclick="deleteCard('${c.token}')">删除</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // 分页控件
  renderPagination(page, pages);
}

function renderPagination(page, pages) {
  let el = document.getElementById('pagination');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pagination';
    el.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:12px;flex-wrap:wrap';
    document.getElementById('card-count').insertAdjacentElement('afterend', el);
  }
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  if (page > 1) html += `<button class="btn-warn" style="padding:5px 12px" onclick="fetchCards(${page-1})">‹ 上一页</button>`;
  // 显示页码（最多显示 5 个）
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  for (let i = start; i <= end; i++) {
    const active = i === page ? 'background:#5b6ef5;color:#fff' : 'background:#f5f7ff;color:#333';
    html += `<button style="padding:5px 10px;border:none;border-radius:6px;cursor:pointer;font-size:13px;${active}" onclick="fetchCards(${i})">${i}</button>`;
  }
  if (page < pages) html += `<button class="btn-warn" style="padding:5px 12px" onclick="fetchCards(${page+1})">下一页 ›</button>`;
  el.innerHTML = html;
}

// ── 套餐配置 ──────────────────────────────────────────────
function renderConfig() {
  const tbody = document.getElementById('config-body');
  if (!tbody) return;
  tbody.innerHTML = Object.entries(cardConfigData).map(([type, cfg]) => `
    <tr>
      <td><strong style="font-family:monospace">${type}</strong></td>
      <td><input type="text" id="cfg-name-${type}" value="${cfg.name}" style="width:90px;padding:5px 8px;border:1.5px solid #ddd;border-radius:6px;font-size:13px"></td>
      <td><input type="number" id="cfg-days-${type}" value="${cfg.days}" min="1" max="3650"></td>
      <td><input type="number" id="cfg-scan-${type}" value="${cfg.scanLimit}" min="1" max="999"></td>
      <td><input type="number" id="cfg-device-${type}" value="${cfg.deviceLimit}" min="1" max="10"></td>
      <td><button class="btn-danger" onclick="deleteCardType('${type}')">删除</button></td>
    </tr>
  `).join('');
}

function deleteCardType(type) {
  if (!confirm(`确认删除套餐「${cardConfigData[type]?.name || type}」？已生成的卡密不受影响。`)) return;
  delete cardConfigData[type];
  renderConfig();
  // 同步更新生成面板的下拉选项
  renderGenTypeOptions();
  showToast('已删除，点击保存配置生效');
}

function addCardType() {
  const key    = document.getElementById('new-type-key').value.trim();
  const name   = document.getElementById('new-type-name').value.trim();
  const days   = parseInt(document.getElementById('new-type-days').value);
  const scan   = parseInt(document.getElementById('new-type-scan').value);
  const device = parseInt(document.getElementById('new-type-device').value);
  const errEl  = document.getElementById('new-type-err');

  if (!key)              { errEl.textContent = '请填写类型Key'; return; }
  if (!/^[a-z0-9_]+$/.test(key)) { errEl.textContent = 'Key只能包含小写字母、数字、下划线'; return; }
  if (!name)             { errEl.textContent = '请填写套餐名称'; return; }
  if (!days || days < 1) { errEl.textContent = '请填写有效天数'; return; }
  if (!scan || scan < 1) { errEl.textContent = '请填写扫码次数'; return; }
  if (!device || device < 1) { errEl.textContent = '请填写设备台数'; return; }
  if (cardConfigData[key]) { errEl.textContent = `Key「${key}」已存在，请换一个`; return; }

  errEl.textContent = '';
  cardConfigData[key] = { name, days, scanLimit: scan, deviceLimit: device };
  renderConfig();
  renderGenTypeOptions();

  // 清空输入框
  ['new-type-key','new-type-name','new-type-days','new-type-scan','new-type-device']
    .forEach(id => document.getElementById(id).value = '');

  showToast(`已添加「${name}」，点击保存配置生效`);
}

function renderGenTypeOptions() {
  const sel = document.getElementById('gen-card-type');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = Object.entries(cardConfigData)
    .map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${v.name}</option>`)
    .join('');
  onCardTypeChange();
}

async function saveConfig() {
  const updates = {};
  for (const type of Object.keys(cardConfigData)) {
    updates[type] = {
      name: document.getElementById(`cfg-name-${type}`)?.value || cardConfigData[type].name,
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
    await fetchCards(1);
  } catch (e) { showToast('生成失败'); }
}

// ── 延期 ──────────────────────────────────────────────────
async function extendCard(token) {
  const days = prompt('延期天数（在当前到期时间基础上增加）：', '30');
  if (!days || isNaN(days) || parseInt(days) < 1) return;
  try {
    const res = await fetch(`/api/admin/cards/${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ action: 'extend', value: parseInt(days) })
    });
    const { code, msg } = await res.json();
    showToast(code === 200 ? `已延期 ${days} 天` : (msg || '操作失败'));
    if (code === 200) await fetchCards(currentPage);
  } catch (e) { showToast('操作失败'); }
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
    if (code === 200) await fetchCards(currentPage);
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
    if (code === 200) await fetchCards(currentPage);
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
    if (code === 200) await fetchCards(currentPage);
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
    if (code === 200) await fetchCards(currentPage);
  } catch (e) { showToast('删除失败'); }
}

// ── 复制 ──────────────────────────────────────────────────
function copyToken(token) {
  const url = `${location.origin}/activate?token=${token}`;
  navigator.clipboard.writeText(url).then(() => showToast('已复制激活链接'));
}

function copyTokenDirect(token) {
  navigator.clipboard.writeText(token).then(() => showToast('卡密已复制'));
}

// ── 备份数据库 ────────────────────────────────────────────
async function backupDB() {
  showToast('正在导出，请稍候...');
  try {
    const res = await fetch('/api/admin/backup', { headers: { 'X-Admin-Key': adminKey } });
    if (!res.ok) { showToast('导出失败'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cards_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✓ 备份已下载');
  } catch (e) { showToast('导出失败: ' + e.message); }
}

// ── 导出 CSV ──────────────────────────────────────────────
function exportCSV(todayOnlyFlag = false) {
  const source = todayOnlyFlag ? allCards.filter(c => isToday(c.createdAt)) : allCards;
  if (!source.length) { showToast(todayOnlyFlag ? '今日暂无卡密' : '暂无卡密'); return; }

  const rows = [['卡密', '卡类型', '状态', '到期时间', '绑定IP', '绑定设备类型', '扫码已用', '扫码上限', '设备上限', '绑定时间', '创建时间']];
  source.forEach(c => {
    rows.push([c.token, CARD_TYPE_LABEL[c.cardType] || c.cardType || '', c.status,
      c.expiresAt || '', c.boundIp || '', c.boundDeviceType || '',
      c.scanUsed ?? 0, c.scanLimit ?? 4, c.deviceLimit ?? 1, c.boundAt || '', c.createdAt || '']);
  });
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const suffix = todayOnlyFlag ? `today_${todayStr()}` : new Date().toISOString().slice(0,10);
  a.download = `cards_${suffix}.csv`;
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
        ? `<span class="badge badge-error">已禁用</span>${dev.disabledReason ? `<br><small style="color:#e05252;font-size:11px">${dev.disabledReason}</small>` : ''}`
        : '<span class="badge badge-ok">可用</span>';
      const lastUsed = dev.lastUsed ? new Date(dev.lastUsed).toLocaleString('zh-CN') : '—';
      const currentTask = dev.currentTaskId
        ? `<span style="font-size:11px;font-family:monospace">${dev.currentTaskId.slice(0,12)}...</span>`
        : '—';
      const toggleBtn = dev.enabled === false
        ? `<button class="btn-primary" style="padding:5px 10px;font-size:12px" onclick="setDeviceEnabled('${dev.serial}', true)">启用</button>`
        : `<button class="btn-danger" onclick="setDeviceEnabledWithReason('${dev.serial}')">禁用</button>`;

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

function setDeviceEnabledWithReason(serial) {
  const reason = prompt('请输入禁用原因（可选，如：账号异常、设备故障等）', '人工手动禁用');
  if (reason === null) return; // 点了取消
  setDeviceEnabled(serial, false, reason);
}

async function setDeviceEnabled(serial, enabled, reason = '') {
  try {
    const body = { enabled };
    if (!enabled && reason) body.reason = reason;
    const res = await fetch(`/api/admin/devices/${encodeURIComponent(serial)}/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify(body)
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
