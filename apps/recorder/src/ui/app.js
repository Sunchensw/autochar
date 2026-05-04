const api = window.autocharRecorder;

const urlInput = document.querySelector('#urlInput');
const openButton = document.querySelector('#openButton');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const exportButton = document.querySelector('#exportButton');
const closeButton = document.querySelector('#closeButton');
const copyReviewButton = document.querySelector('#copyReviewButton');
const saveReviewButton = document.querySelector('#saveReviewButton');
const flowName = document.querySelector('#flowName');
const notes = document.querySelector('#notes');
const statusBadge = document.querySelector('#statusBadge');
const stepCount = document.querySelector('#stepCount');
const screenshotCount = document.querySelector('#screenshotCount');
const lastAction = document.querySelector('#lastAction');
const exportPath = document.querySelector('#exportPath');
const commandStatus = document.querySelector('#commandStatus');
const reviewMarkdown = document.querySelector('#reviewMarkdown');
const log = document.querySelector('#log');

let stopped = false;
let lastCommandMessage = '等待操作';
let currentReviewMarkdown = '';

function formatDebugLog(state) {
  const lines = state.debugLog || [];
  if (!lines.length) {
    return '暂无采集日志';
  }
  return lines.slice(-120).join('\n');
}

function render(state) {
  statusBadge.textContent = state.isRecording ? '录制中' : state.isOpen ? '浏览器已打开' : '未打开';
  stepCount.textContent = String(state.stepCount ?? 0);
  screenshotCount.textContent = String(state.screenshotCount ?? 0);
  lastAction.textContent = state.lastAction || '-';
  exportPath.textContent = state.exportPath || '-';
  commandStatus.textContent = lastCommandMessage;
  reviewMarkdown.value = currentReviewMarkdown;
  log.textContent = formatDebugLog(state);

  startButton.disabled = !state.isOpen || state.isRecording;
  stopButton.disabled = !state.isRecording;
  exportButton.disabled = !stopped;
  copyReviewButton.disabled = !currentReviewMarkdown;
  saveReviewButton.disabled = !currentReviewMarkdown;
}

async function refreshState() {
  const state = await api.state();
  render(state);
}

async function run(action, onSuccess) {
  try {
    const result = await action();
    lastCommandMessage = onSuccess?.(result) || 'OK';
    await refreshState();
  } catch (error) {
    lastCommandMessage = error.message || String(error);
    commandStatus.textContent = lastCommandMessage;
  }
}

async function copyReviewMarkdown() {
  if (!currentReviewMarkdown) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(currentReviewMarkdown);
  } else {
    reviewMarkdown.focus();
    reviewMarkdown.select();
    document.execCommand('copy');
  }
}

openButton.addEventListener('click', () => run(
  () => api.open(urlInput.value),
  () => {
    stopped = false;
    currentReviewMarkdown = '';
    return 'Chromium 已打开并开始录制';
  }
));

startButton.addEventListener('click', () => run(
  () => api.start(),
  () => {
    stopped = false;
    currentReviewMarkdown = '';
    return '已开始录制';
  }
));

stopButton.addEventListener('click', () => run(
  () => api.stop(),
  (result) => {
    stopped = true;
    currentReviewMarkdown = result.reviewMarkdown || '';
    return `已停止录制，flow 包含 ${result.flow.steps.length} 个步骤`;
  }
));

copyReviewButton.addEventListener('click', () => run(
  copyReviewMarkdown,
  () => '审核文本已复制'
));

saveReviewButton.addEventListener('click', () => run(
  () => api.saveReview({ name: flowName.value || 'Autochar Recording', markdown: currentReviewMarkdown }),
  (result) => result.savedPath ? `审核文本已保存：${result.savedPath}` : '已取消保存审核文本'
));

exportButton.addEventListener('click', () => {
  const confirmed = confirm('.flow.zip 将包含页面截图 PNG、采集调试日志和 review.md。确认导出？');
  if (!confirmed) return;
  run(
    () => api.export({ name: flowName.value, notes: notes.value, reviewMarkdown: currentReviewMarkdown }),
    (state) => `导出完成：${state.exportPath}`
  );
});

closeButton.addEventListener('click', () => run(
  () => api.closeBrowser(),
  () => {
    stopped = false;
    currentReviewMarkdown = '';
    return '浏览器已关闭';
  }
));

refreshState().catch((error) => {
  lastCommandMessage = error.message || String(error);
  commandStatus.textContent = lastCommandMessage;
});

setInterval(() => {
  refreshState().catch(() => undefined);
}, 1000);
