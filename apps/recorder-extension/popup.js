const DEFAULT_RECEIVER_URL = 'http://127.0.0.1:17321';

const receiverUrl = document.querySelector('#receiverUrl');
const token = document.querySelector('#token');
const enabled = document.querySelector('#enabled');
const saveButton = document.querySelector('#saveButton');
const testButton = document.querySelector('#testButton');
const status = document.querySelector('#status');

function setStatus(message) {
  status.textContent = message;
}

function normalizedUrl() {
  return (receiverUrl.value || DEFAULT_RECEIVER_URL).replace(/\/+$/, '');
}

async function load() {
  const config = await chrome.storage.local.get({
    receiverUrl: DEFAULT_RECEIVER_URL,
    token: '',
    enabled: true
  });
  receiverUrl.value = config.receiverUrl || DEFAULT_RECEIVER_URL;
  token.value = config.token || '';
  enabled.checked = Boolean(config.enabled);
}

async function save() {
  await chrome.storage.local.set({
    receiverUrl: normalizedUrl(),
    token: token.value.trim(),
    enabled: enabled.checked
  });
  setStatus('已保存连接信息');
}

async function testConnection() {
  await save();
  try {
    const response = await fetch(`${normalizedUrl()}/health`);
    if (!response.ok) {
      setStatus(`连接失败：HTTP ${response.status}`);
      return;
    }
    const result = await response.json();
    setStatus(result.ok ? '连接正常，可以开始录制' : '连接失败：Recorder 未就绪');
  } catch (error) {
    setStatus(`连接失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

saveButton.addEventListener('click', () => {
  save().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
});

testButton.addEventListener('click', () => {
  testConnection().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
});

load().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
