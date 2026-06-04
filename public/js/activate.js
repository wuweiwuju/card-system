const token = new URLSearchParams(location.search).get('token');
let codeReader = null;
let cameraStream = null;

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
    const res = await fetch(`/api/activate?token=${encodeURIComponent(token)}`);
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

    // 激活面板
    if (data.status === 'unused') {
      document.getElementById('activate-panel').style.display = 'block';
    }

    if (data.status === 'expired') {
      showToast('该卡密已过期');
      expiresEl.style.color = '#e05252';
    }
    if (data.status === 'disabled') {
      showToast('该卡密已被禁用');
    }
  } catch (e) {
    showToast('网络错误，请稍后重试');
  }
}

// ── 激活 ──────────────────────────────────────────────────
async function activateCard() {
  try {
    const res = await fetch('/api/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
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
      body: JSON.stringify({ token })
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
  resEl.textContent = '⏳ 正在上传二维码，请稍候...';

  const formData = new FormData();
  formData.append('token', token);
  formData.append('image', file);

  try {
    const res = await fetch('/api/scan-qr', { method: 'POST', body: formData });
    const { code, msg, data } = await res.json();

    if (code === 200 && data && data.status === 'pending') {
      resEl.textContent = '⏳ 二维码已提交，正在处理中...';
      // 轮询任务结果
      pollTaskStatus(resEl);
    } else if (code === 200) {
      resEl.style.background = '#f0fdf4';
      resEl.style.borderColor = '#86efac';
      resEl.style.color = '#166534';
      resEl.textContent = '✓ ' + msg;
    } else {
      resEl.style.background = '#fff5f5';
      resEl.style.borderColor = '#fca5a5';
      resEl.style.color = '#991b1b';
      resEl.textContent = '✗ ' + msg;
    }
    showToast(msg);
  } catch (e) {
    resEl.textContent = '✗ 上传失败：' + e.message;
    showToast('上传失败：' + e.message);
  }
}

// 轮询任务状态
async function pollTaskStatus(resEl, retries = 15) {
  for (let i = 0; i < retries; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch(`/api/task-status?token=${encodeURIComponent(token)}`);
      const { code, data } = await res.json();
      if (code !== 200 || !data) continue;

      if (data.status === 'success') {
        resEl.style.background = '#f0fdf4';
        resEl.style.borderColor = '#86efac';
        resEl.style.color = '#166534';
        resEl.textContent = '✓ 登录成功！';
        showToast('登录成功！');
        return;
      } else if (data.status === 'failed') {
        resEl.style.background = '#fff5f5';
        resEl.style.borderColor = '#fca5a5';
        resEl.style.color = '#991b1b';
        resEl.textContent = '✗ 登录失败：' + (data.result && data.result.message || '未知错误');
        showToast('登录失败');
        return;
      }
      resEl.textContent = `⏳ 处理中... (${i + 1}/${retries})`;
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

// ── 工具函数 ──────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}
