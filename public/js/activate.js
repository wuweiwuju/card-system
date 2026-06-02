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

  const img = new Image();
  img.onload = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);

    try {
      if (typeof ZXing !== 'undefined') {
        const reader = new ZXing.BrowserQRCodeReader();
        const result = await reader.decodeFromCanvas(canvas);
        handleQRResult(result.getText());
      } else {
        showToast('ZXing 库加载失败，请刷新重试');
      }
    } catch (e) {
      showToast('未能识别二维码，请确认图片清晰');
    }
  };
  img.src = URL.createObjectURL(file);
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
