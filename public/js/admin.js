let adminKey = '';
let allCards = [];

const STATUS_LABEL = {
  unused:   '<span class="badge badge-warn">未激活</span>',
  active:   '<span class="badge badge-ok">已激活</span>',
  expired:  '<span class="badge badge-error">已过期</span>',
  disabled: '<span class="badge" style="background:#f0f0f0;color:#888">已禁用</span>',
};

// ── 登录 ──────────────────────────────────────────────────
function login() {
  adminKey = document.getElementById('admin-key').value.trim();
  if (!adminKey) return;
  fetchCards().then(ok => {
    if (ok) {
      document.getElementById('login-panel').style.display = 'none';
      document.getElementById('admin-panel').style.display = 'block';
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
  } catch (e) {
    showToast('网络错误');
    return false;
  }
}

function renderTable() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const filtered = allCards.filter(c =>
    c.token.toLowerCase().includes(q) ||
    (c.boundIp && c.boundIp.includes(q))
  );

  document.getElementById('card-count').textContent = `共 ${allCards.length} 个卡密，显示 ${filtered.length} 个`;

  const tbody = document.getElementById('table-body');
  tbody.innerHTML = filtered.map(c => {
    const exp = c.expiresAt ? new Date(c.expiresAt).toLocaleString('zh-CN') : '—';
    const ip = c.boundIp || '—';
    const actions = c.status === 'disabled'
      ? `<button class="btn-warn" onclick="toggleCard('${c.token}','enable')">启用</button>`
      : `<button class="btn-warn" onclick="toggleCard('${c.token}','disable')">禁用</button>`;
    return `<tr>
      <td style="font-family:monospace;font-size:12px">${c.token}</td>
      <td>${STATUS_LABEL[c.status] || c.status}</td>
      <td>${c.days} 天</td>
      <td>${exp}</td>
      <td style="font-size:12px">${ip}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-primary" style="padding:6px 10px;font-size:12px" onclick="copyToken('${c.token}')">复制</button>
        ${actions}
        <button class="btn-danger" onclick="deleteCard('${c.token}')">删除</button>
      </td>
    </tr>`;
  }).join('');
}

// ── 生成卡密 ──────────────────────────────────────────────
function showGenPanel() {
  const p = document.getElementById('gen-panel');
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
  document.getElementById('gen-result').textContent = '';
}

async function generateCards() {
  const count = parseInt(document.getElementById('gen-count').value) || 1;
  const days  = parseInt(document.getElementById('gen-days').value) || 30;
  try {
    const res = await fetch('/api/admin/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ count, days })
    });
    const { code, data, msg } = await res.json();
    if (code !== 200) { showToast(msg); return; }
    document.getElementById('gen-result').textContent = `✓ 已生成 ${data.length} 个`;
    await fetchCards();
  } catch (e) {
    showToast('生成失败');
  }
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
  } catch (e) {
    showToast('操作失败');
  }
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
  } catch (e) {
    showToast('删除失败');
  }
}

// ── 复制 ──────────────────────────────────────────────────
function copyToken(token) {
  const url = `${location.origin}/activate?token=${token}`;
  navigator.clipboard.writeText(url).then(() => showToast('已复制激活链接'));
}

// ── 导出 CSV ──────────────────────────────────────────────
function exportCSV() {
  const rows = [['卡密', '状态', '有效天数', '到期时间', '绑定IP', '绑定时间', '创建时间']];
  allCards.forEach(c => {
    rows.push([c.token, c.status, c.days, c.expiresAt || '', c.boundIp || '', c.boundAt || '', c.createdAt || '']);
  });
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cards_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ── Toast ──────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}
