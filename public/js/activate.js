const token = new URLSearchParams(location.search).get('token');
let codeReader = null;
let cameraStream = null;
let selectedDeviceType = localStorage.getItem('_devtype') || 'phone';
let cardInfo = null; // 缓存卡密信息，供弹窗使用
let pendingAction = null; // 用户确认设备类型后执行的回调

// 获取或生成设备ID（存 localStorage，换网络不变）
function getDeviceId() {
  let id = localStorage.getItem('_did');
  if (!id) {
    id = 'D' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('_did', id);
  }
  return id;
}
const deviceId = getDeviceId();

// ── 初始化 ────────────────────────────────────────────────
(async function init() {
  if (!token) {
    showToast('缺少 token 参数');
    document.getElementById('display-token').textContent = '卡密：无效';
    return;
  }
  document.getElementById('display-token').textContent = '卡密：' + token;
  await loadCardInfo();
})();

async function loadCardInfo() {
  try {
    const res = await fetch(`/api/activate?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(deviceId)}`);
    const { code, data, msg } = await res.json();
    if (code !== 200) { showToast(msg || '查询失败'); return; }
    cardInfo = data;

    // 到期时间
    const expiresEl = document.getElementById('expires-at');
    if (data.expiresAt) {
      const d = new Date(data.expiresAt);
      expiresEl.textContent = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    // 卡类型
    const typeEl = document.getElementById('card-type-name');
    if (typeEl && data.cardTypeName) typeEl.textContent = data.cardTypeName;

    // 更新提示文字
    const tipEl = document.getElementById('tip-device-rule');
    if (tipEl && data.deviceLimit) {
      tipEl.textContent = `${data.cardTypeName || '此卡'}可登录 ${data.deviceLimit} 台设备，一旦绑定无法更换，请谨慎操作`;
    }

    // 绑定设备
    const devEl = document.getElementById('bound-device');
    if (data.boundDevice) {
      const devTypeMap = { phone:'📱手机', pc:'💻电脑', tv:'📺电视', tablet:'📟平板' };
      const devTypeLabel = data.boundDeviceType ? (devTypeMap[data.boundDeviceType] || '') : '';
      devEl.innerHTML = `<span class="badge badge-ok">✓ 已绑定</span>${devTypeLabel ? `<small style="color:#888;font-size:11px;margin-top:4px;display:block">${devTypeLabel}</small>` : ''}`;
    } else {
      devEl.innerHTML = `<span class="badge badge-warn">⚠ 未绑定</span>`;
    }

    // 扫码次数
    if (data.scanLimit !== undefined) {
      const remain = data.scanLimit - data.scanUsed;
      const scanEl = document.getElementById('scan-remain');
      if (scanEl) {
        scanEl.textContent = `扫码剩余 ${remain} / ${data.scanLimit} 次`;
        scanEl.style.color = remain <= 1 ? '#e05252' : '#18a058';
      }
      if (remain <= 0) { showStatusBlock('scan_limit'); return; }
    }

    // 非本机 → 锁定
    if (data.boundDevice && data.isOwner === false) {
      showBoundWarning();
      return;
    }

    // 状态检查
    if (data.status === 'expired') {
      document.getElementById('expires-at').style.color = '#e05252';
      showStatusBlock('expired');
      return;
    }
    if (data.status === 'disabled') {
      showStatusBlock('disabled');
      return;
    }

    // 首次打开弹窗（只弹一次）
    if (!localStorage.getItem('_welcomed_' + token)) {
      showWelcomeModal(data);
    }

    // 激活面板
    if (data.status === 'unused') {
      document.getElementById('activate-panel').style.display = 'block';
    }

    // 如果已有绑定设备类型，更新副标题
    if (data.boundDeviceType) {
      const devTypeMap = { phone:'手机', pc:'电脑', tv:'电视', tablet:'平板' };
      const sub = document.getElementById('sc-subtitle');
      if (sub) sub.textContent = `当前设备类型：${devTypeMap[data.boundDeviceType] || data.boundDeviceType}`;
      selectedDeviceType = data.boundDeviceType;
    }

  } catch (e) {
    showToast('网络错误，请稍后重试');
  }
}

// ── 首次欢迎弹窗 ──────────────────────────────────────────
function showWelcomeModal(data) {
  const typeMap = {
    monthly:  { name: '月卡',      rule: '只能登录 1 台设备，一旦绑定无法自行更换' },
    seasonal: { name: '季卡',      rule: '可登录 2 台设备（如手机+电视），一旦绑定无法自行更换' },
    yearly:   { name: '年卡',      rule: '可登录 2 台设备，一旦绑定无法自行更换' },
    nba:      { name: 'NBA赛季卡', rule: '可登录 2 台设备，一旦绑定无法自行更换' },
    f1:       { name: 'F1赛季卡',  rule: '可登录 2 台设备，一旦绑定无法自行更换' },
  };
  const cfg = typeMap[data.cardType] || { name: data.cardTypeName || '会员卡', rule: `可登录 ${data.deviceLimit || 1} 台设备` };

  document.getElementById('modal-card-type-desc').textContent = `您当前使用的是【${cfg.name}】`;
  document.getElementById('modal-rules').innerHTML = `
    <div class="rule-item"><div class="rule-num">1</div><p>${cfg.rule}</p></div>
    <div class="rule-item"><div class="rule-num">2</div><p>上传二维码后请立即返回 APP，不要做任何操作，等待登录完成</p></div>
    <div class="rule-item"><div class="rule-num">3</div><p>扫码次数有限制，登录失败也会消耗次数，请确认二维码清晰后再上传</p></div>
  `;
  document.getElementById('modal-welcome').classList.add('show');
}

function closeWelcome() {
  document.getElementById('modal-welcome').classList.remove('show');
  localStorage.setItem('_welcomed_' + token, '1');
}

// ── 设备类型弹窗 ──────────────────────────────────────────
function showDeviceTypeModal(callback) {
  pendingAction = callback;
  // 高亮已选
  document.querySelectorAll('.device-type-btn').forEach(b => b.classList.remove('selected'));
  const map = { phone: 0, pc: 1, tv: 2, tablet: 3 };
  const idx = map[selectedDeviceType] ?? 0;
  document.querySelectorAll('.device-type-btn')[idx]?.classList.add('selected');
  document.getElementById('modal-device-type').classList.add('show');
}

function selectDeviceType(type) {
  selectedDeviceType = type;
  localStorage.setItem('_devtype', type);
  document.querySelectorAll('.device-type-btn').forEach(b => b.classList.remove('selected'));
  event.target.classList.add('selected');
  closeDeviceModal();
  if (pendingAction) { pendingAction(); pendingAction = null; }
}

function closeDeviceModal() {
  document.getElementById('modal-device-type').classList.remove('show');
}

// ── 按钮点击拦截：先弹设备类型确认 ──────────────────────────
function onScanBtn(type, e) {
  if (e) e.preventDefault();

  // 如果已有绑定设备类型，直接执行，无需再选
  if (cardInfo && cardInfo.boundDeviceType) {
    if (type === 'camera') startCamera();
    else document.getElementById('qr-file').click();
    return;
  }

  // 弹设备类型选择
  showDeviceTypeModal(() => {
    if (type === 'camera') startCamera();
    else document.getElementById('qr-file').click();
  });
}

// ── 状态提示块 ────────────────────────────────────────────
function showStatusBlock(status) {
  document.querySelector('.scan-card').style.display = 'none';
  document.querySelector('.btn-unbind').style.display = 'none';

  const configs = {
    disabled: {
      bg: '#fef3c7', border: '#d97706', color: '#78350f',
      icon: '🚫', title: '卡密已被禁用',
      desc: '此卡密已被管理员禁用，无法使用<br>如有疑问请联系客服处理',
    },
    expired: {
      bg: '#fee2e2', border: '#dc2626', color: '#7f1d1d',
      icon: '⏰', title: '卡密已过期',
      desc: '此卡密已超过有效期，无法继续使用<br>请联系客服续费或重新购买',
    },
    scan_limit: {
      bg: '#fef3c7', border: '#f59e0b', color: '#78350f',
      icon: '🔢', title: '扫码次数已用完',
      desc: '此卡密的扫码次数已全部使用<br>请联系客服增加次数后继续使用',
    },
  };
  const c = configs[status];
  if (!c) return;

  const warn = document.createElement('div');
  warn.style.cssText = `background:${c.bg};border:2px solid ${c.border};border-radius:14px;padding:20px;text-align:center;`;
  warn.innerHTML = `
    <div style="font-size:20px;font-weight:800;color:${c.color};margin-bottom:8px">${c.icon} ${c.title}</div>
    <div style="font-size:14px;color:${c.color};line-height:1.7;margin-bottom:14px">${c.desc}</div>
    <button onclick="openService()" style="background:${c.border};color:#fff;border:none;border-radius:10px;padding:12px 28px;font-size:15px;font-weight:700;cursor:pointer;">
      📞 联系客服
    </button>
  `;
  document.querySelector('.scan-card').insertAdjacentElement('beforebegin', warn);
}

// ── 非本机提示 ────────────────────────────────────────────
function showBoundWarning() {
  document.querySelector('.scan-card').style.display = 'none';
  document.querySelector('.btn-unbind').style.display = 'none';

  const warn = document.createElement('div');
  warn.style.cssText = 'background:#fee2e2;border:2px solid #dc2626;border-radius:14px;padding:20px;text-align:center;';
  warn.innerHTML = `
    <div style="font-size:20px;font-weight:800;color:#991b1b;margin-bottom:8px">⛔ 设备不匹配</div>
    <div style="font-size:14px;color:#7f1d1d;line-height:1.7;margin-bottom:14px">
      此卡密已绑定其他设备<br>当前设备无法使用，请联系客服解绑后再访问
    </div>
    <button onclick="openService()" style="background:#dc2626;color:#fff;border:none;border-radius:10px;padding:12px 28px;font-size:15px;font-weight:700;cursor:pointer;">
      📞 联系客服解绑
    </button>
  `;
  document.querySelector('.scan-card').insertAdjacentElement('beforebegin', warn);
}

// ── 激活 ──────────────────────────────────────────────────
async function activateCard() {
  try {
    const res = await fetch('/api/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceId })
    });
    const { code, msg } = await res.json();
    showToast(msg);
    if (code === 200) {
      document.getElementById('activate-panel').style.display = 'none';
      await loadCardInfo();
    }
  } catch (e) { showToast('网络错误'); }
}

// ── 解绑 ──────────────────────────────────────────────────
async function unbindDevice() {
  if (!confirm('确认解除当前设备绑定？')) return;
  try {
    const res = await fetch('/api/unbind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceId })
    });
    const { code, msg } = await res.json();
    showToast(msg);
    if (code === 200) await loadCardInfo();
  } catch (e) { showToast('网络错误'); }
}

// ── 摄像头扫码 ────────────────────────────────────────────
async function startCamera() {
  const wrap = document.getElementById('camera-wrap');
  const video = document.getElementById('camera-video');
  wrap.style.display = 'block';
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = cameraStream;
    if (typeof ZXing !== 'undefined') {
      codeReader = new ZXing.BrowserQRCodeReader();
      codeReader.decodeFromVideoDevice(null, 'camera-video', (result) => {
        if (result) { stopCamera(); doUploadFile(null, result.getText()); }
      });
    }
  } catch (e) {
    showToast('无法访问摄像头：' + e.message);
    wrap.style.display = 'none';
  }
}

function stopCamera() {
  document.getElementById('camera-wrap').style.display = 'none';
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  if (codeReader) { try { codeReader.reset(); } catch(e){} codeReader = null; }
}

// ── 上传二维码 ────────────────────────────────────────────
function uploadQR(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  doUploadFile(file, null);
}

async function doUploadFile(file, qrText) {
  const resEl = document.getElementById('qr-result');
  resEl.style.display = 'block';
  resEl.style.background = '#f0f9ff';
  resEl.style.borderColor = '#7dd3fc';
  resEl.style.color = '#0369a1';
  resEl.style.fontSize = '14px';
  resEl.style.lineHeight = '1.7';
  resEl.textContent = '⏳ 正在上传，请稍候...';

  const formData = new FormData();
  formData.append('token', token);
  formData.append('deviceType', selectedDeviceType);
  if (file) formData.append('image', file);
  if (qrText) formData.append('qrContent', qrText);

  try {
    const res = await fetch('/api/scan-qr', { method: 'POST', body: formData });
    const { code, msg, data } = await res.json();

    if (code === 200 && data && data.status === 'pending') {
      resEl.style.background = '#fff8e7';
      resEl.style.borderColor = '#f5c842';
      resEl.style.color = '#92400e';
      resEl.innerHTML = `
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">⚠️ 二维码已提交！</div>
        <div style="font-size:15px;font-weight:700;color:#d97706">📱 请立即返回腾讯体育 APP</div>
        <div style="font-size:13px;margin-top:4px;color:#78350f">保持二维码页面不要关闭，等待登录完成...</div>
        <button onclick="openTencentSports()" style="margin-top:10px;width:100%;padding:12px;background:linear-gradient(135deg,#1677ff,#0958d9);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">
          📱 点击返回腾讯体育 APP
        </button>
      `;
      pollTaskStatus(resEl);
    } else if (code === 200) {
      resEl.style.background = '#f0fdf4';
      resEl.style.borderColor = '#86efac';
      resEl.style.color = '#166534';
      resEl.textContent = '✓ ' + msg;
    } else {
      resEl.style.background = '#fee2e2';
      resEl.style.borderColor = '#dc2626';
      resEl.style.color = '#7f1d1d';
      resEl.innerHTML = `
        <div style="font-size:17px;font-weight:800;margin-bottom:6px">⚠️ ${msg || '提交失败'}</div>
        <div style="font-size:13px;margin-top:4px">请稍后重试或联系客服</div>
      `;
    }
  } catch (e) {
    resEl.textContent = '✗ 上传失败：' + e.message;
  }
}

// ── 轮询任务状态 ──────────────────────────────────────────
async function pollTaskStatus(resEl, retries = 30) {
  const statusText = {
    queued:   '⏳ 排队中，等待设备处理...',
    assigned: '📱 已分配设备，准备扫码...',
    running:  '🔄 正在执行扫码登录，请勿关闭...',
    pending:  '⏳ 正在处理中...',
  };

  for (let i = 0; i < retries; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const res = await fetch(`/api/task-status?token=${encodeURIComponent(token)}`);
      const { code, data } = await res.json();
      if (code !== 200 || !data) continue;

      if (data.status === 'success') {
        resEl.style.background = '#dcfce7';
        resEl.style.borderColor = '#16a34a';
        resEl.style.color = '#14532d';
        resEl.innerHTML = `
          <div style="font-size:18px;font-weight:800;margin-bottom:6px">✅ 登录成功！</div>
          <div style="font-size:16px;font-weight:700;color:#15803d">📱 请返回腾讯体育 APP</div>
          <div style="font-size:13px;margin-top:4px;color:#166534">已成功登录，返回 APP 即可正常使用会员</div>
        `;
        showToast('✅ 登录成功！请返回腾讯体育 APP');
        await loadCardInfo(); // 刷新次数显示
        return;
      }

      if (data.status === 'failed') {
        resEl.style.background = '#fee2e2';
        resEl.style.borderColor = '#dc2626';
        resEl.style.color = '#7f1d1d';
        const errCode = data.result && data.result.errorCode;
        let errMsg = '';
        if (errCode === 'QR_EXPIRED') {
          errMsg = `<div style="font-size:17px;font-weight:800;margin-bottom:6px">❌ 二维码已过期</div>
            <div style="font-size:14px;font-weight:700;color:#b91c1c">📱 请返回腾讯体育 APP</div>
            <div style="font-size:13px;margin-top:4px">重新进入扫码页面，截图后<strong>立即上传</strong></div>`;
        } else if (errCode === 'PUSH_FAILED') {
          errMsg = `<div style="font-size:17px;font-weight:800;margin-bottom:6px">❌ 设备未连接</div>
            <div style="font-size:13px;margin-top:4px">请联系客服处理</div>`;
        } else {
          errMsg = `<div style="font-size:17px;font-weight:800;margin-bottom:6px">❌ 登录失败，请重试</div>
            <div style="font-size:14px;font-weight:700;color:#b91c1c">📱 请返回腾讯体育 APP</div>
            <div style="font-size:13px;margin-top:4px">重新获取二维码后再次上传</div>`;
        }
        resEl.innerHTML = errMsg;
        showToast('❌ 登录失败，请重试');
        return;
      }

      // 中间状态更新提示
      const hint = statusText[data.status] || '⏳ 处理中...';
      const lastDiv = resEl.querySelector('div:nth-child(3)');
      if (lastDiv) lastDiv.textContent = hint;

    } catch (e) { continue; }
  }
  resEl.textContent = '⌛ 处理超时，请稍后刷新页面查看结果';
}

// ── 唤起 APP ──────────────────────────────────────────────
function openTencentSports() {
  window.location.href = 'tencentsports://';
  setTimeout(() => showToast('请手动切换回腾讯体育 APP'), 300);
}

function openService() {
  showToast('请联系管理员获取客服方式');
}

// ── 工具函数 ──────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}
