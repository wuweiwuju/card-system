const token = new URLSearchParams(location.search).get('token');
let codeReader = null;
let cameraStream = null;

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

    // 到期时间
    const expiresEl = document.getElementById('expires-at');
    if (data.expiresAt) {
      const d = new Date(data.expiresAt);
      expiresEl.textContent = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    // 绑定设备
    const devEl = document.getElementById('bound-device');
    if (data.boundDevice) {
      devEl.innerHTML = `<span class="badge badge-ok">✓ 已绑定</span><br><small style="color:#888;font-size:11px;margin-top:4px;display:block">${data.boundDevice}</small>`;
    } else {
      devEl.innerHTML = `<span class="badge badge-warn">⚠ 未绑定</span>`;
    }

    // 非本机访问 → 锁定页面
    if (data.boundDevice && data.isOwner === false) {
      showBoundWarning(data.boundDevice);
      return;
    }

    // 激活面板
    if (data.status === 'unused') {
      document.getElementById('activate-panel').style.display = 'block';
    }

    if (data.status === 'expired') {
      showToast('该卡密已过期');
      expiresEl.style.color = '#e05252';
      showStatusBlock('expired');
    }
    if (data.status === 'disabled') {
      showStatusBlock('disabled');
    }
  } catch (e) {
    showToast('网络错误，请稍后重试');
  }
}

// ── 状态提示（禁用/过期）────────────────────────────────────
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
function showBoundWarning(boundIp) {
  // 隐藏扫码区、解绑按钮
  document.querySelector('.scan-card').style.display = 'none';
  document.querySelector('.btn-unbind').style.display = 'none';

  // 在扫码区前插入警告
  const warn = document.createElement('div');
  warn.style.cssText = 'background:#fee2e2;border:2px solid #dc2626;border-radius:14px;padding:20px;text-align:center;';
  warn.innerHTML = `
    <div style="font-size:20px;font-weight:800;color:#991b1b;margin-bottom:8px">⛔ 设备不匹配</div>
    <div style="font-size:14px;color:#7f1d1d;line-height:1.7;margin-bottom:14px">
      此卡密已绑定其他设备（${boundIp}）<br>
      当前设备无法使用，请联系客服解绑后再访问
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
  } catch (e) {
    showToast('网络错误');
  }
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
  } catch (e) {
    showToast('网络错误');
  }
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
      codeReader.decodeFromVideoDevice(null, 'camera-video', (result, err) => {
        if (result) {
          stopCamera();
          handleQRResult(result.getText());
        }
      });
    } else {
      // ZXing 未加载时降级：每帧截图后解码
      scanFrameLoop(video);
    }
  } catch (e) {
    showToast('无法访问摄像头：' + e.message);
    wrap.style.display = 'none';
  }
}

function stopCamera() {
  const wrap = document.getElementById('camera-wrap');
  wrap.style.display = 'none';
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  if (codeReader) { try { codeReader.reset(); } catch(e){} codeReader = null; }
}

// ── 上传二维码 ────────────────────────────────────────────
async function uploadQR(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const resEl = document.getElementById('qr-result');
  resEl.style.display = 'block';
  resEl.style.background = '#f0f9ff';
  resEl.style.borderColor = '#7dd3fc';
  resEl.style.color = '#0369a1';
  resEl.style.fontSize = '14px';
  resEl.style.lineHeight = '1.7';
  resEl.textContent = '⏳ 正在上传二维码，请稍候...';

  const formData = new FormData();
  formData.append('token', token);
  formData.append('image', file);

  try {
    const res = await fetch('/api/scan-qr', { method: 'POST', body: formData });
    const { code, msg, data } = await res.json();

    if (code === 200 && data && data.status === 'pending') {
      // 提交成功后立即提示返回 APP
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
      resEl.style.fontSize = '14px';
      resEl.style.lineHeight = '1.7';
      resEl.innerHTML = `
        <div style="font-size:17px;font-weight:800;margin-bottom:6px">⚠️ 服务暂时不可用</div>
        <div style="font-size:13px">请稍等几分钟后重新上传，或联系客服</div>
      `;
    }
  } catch (e) {
    resEl.textContent = '✗ 上传失败：' + e.message;
    showToast('上传失败：' + e.message);
  }
}

// 轮询任务状态
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
        resEl.style.fontSize = '14px';
        resEl.style.lineHeight = '1.7';
        resEl.innerHTML = `
          <div style="font-size:18px;font-weight:800;margin-bottom:6px">✅ 登录成功！</div>
          <div style="font-size:16px;font-weight:700;color:#15803d">📱 请返回腾讯体育 APP</div>
          <div style="font-size:13px;margin-top:4px;color:#166534">已成功登录，返回 APP 即可正常使用会员</div>
        `;
        showToast('✅ 登录成功！请返回腾讯体育 APP');
        return;
      } else if (data.status === 'failed') {
        resEl.style.background = '#fee2e2';
        resEl.style.borderColor = '#dc2626';
        resEl.style.color = '#7f1d1d';
        resEl.style.fontSize = '14px';
        resEl.style.lineHeight = '1.7';
        const errCode = data.result && data.result.errorCode;
        let errMsg = '';
        if (errCode === 'QR_EXPIRED') {
          errMsg = `
            <div style="font-size:17px;font-weight:800;margin-bottom:6px">❌ 二维码已过期</div>
            <div style="font-size:14px;font-weight:700;color:#b91c1c">📱 请返回腾讯体育 APP</div>
            <div style="font-size:13px;margin-top:4px">重新进入扫码登录页面，截图后<strong>立即上传</strong>（1分钟内）</div>
          `;
        } else if (errCode === 'PUSH_FAILED') {
          errMsg = `
            <div style="font-size:17px;font-weight:800;margin-bottom:6px">❌ 设备未连接</div>
            <div style="font-size:13px;margin-top:4px">请联系客服处理</div>
          `;
        } else {
          errMsg = `
            <div style="font-size:17px;font-weight:800;margin-bottom:6px">❌ 登录失败，请重试</div>
            <div style="font-size:14px;font-weight:700;color:#b91c1c">📱 请返回腾讯体育 APP</div>
            <div style="font-size:13px;margin-top:4px">重新获取二维码后再次上传</div>
          `;
        }
        resEl.innerHTML = errMsg;
        showToast('❌ 登录失败，请重试');
        return;
      }

      // 中间状态：更新提示文字，保持黄色框不变
      const hint = statusText[data.status] || `⏳ 处理中...`;
      resEl.querySelector
        ? (resEl.querySelector('div:last-child') || resEl).textContent = hint
        : null;

    } catch (e) { continue; }
  }
  resEl.textContent = '⌛ 处理超时，请稍后刷新页面查看结果';
}

// ── 处理二维码结果 ────────────────────────────────────────
async function handleQRResult(content) {
  const resEl = document.getElementById('qr-result');
  resEl.style.display = 'block';
  resEl.textContent = '✓ 识别成功：' + content;

  try {
    const res = await fetch('/api/scan-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, qrContent: content })
    });
    const { code, msg } = await res.json();
    showToast(code === 200 ? '二维码已上传' : msg);
  } catch (e) {
    showToast('上传失败：' + e.message);
  }
}

// ── 教程 ──────────────────────────────────────────────────
function showTutorial() {
  alert('使用说明：\n1. 激活卡密，绑定本机\n2. 点击「扫码登录」使用摄像头扫码\n3. 或点击「上传二维码」选择图片\n4. 识别成功后结果将上传至服务器');
}

function openService() {
  showToast('请联系管理员获取客服方式');
}

// ── 唤起腾讯体育 APP ──────────────────────────────────────
function openTencentSports() {
  // 尝试用 URL Scheme 唤起腾讯体育
  const schemes = [
    'tencentsports://',       // 腾讯体育
    'tencentvideo://',        // 腾讯视频
  ];
  // 先尝试唤起
  window.location.href = schemes[0];
  // 300ms 后如果没跳走说明没安装，提示用户手动切换
  setTimeout(() => {
    showToast('请手动切换回腾讯体育 APP');
  }, 300);
}

// ── 工具函数 ──────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}
