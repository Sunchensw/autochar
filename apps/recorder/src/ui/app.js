const api = window.autocharRecorder;
const urlInput = document.querySelector('#urlInput');
const openButton = document.querySelector('#openButton');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const exportButton = document.querySelector('#exportButton');
const closeButton = document.querySelector('#closeButton');
const flowName = document.querySelector('#flowName');
const notes = document.querySelector('#notes');
const statusBadge = document.querySelector('#statusBadge');
const stepCount = document.querySelector('#stepCount');
const screenshotCount = document.querySelector('#screenshotCount');
const lastAction = document.querySelector('#lastAction');
const exportPath = document.querySelector('#exportPath');
const log = document.querySelector('#log');
let stopped = false;

function setLog(message) {
  log.textContent = message;
}

function render(state) {
  statusBadge.textContent = state.isRecording ? '录制中' : state.isOpen ? '浏览器已打开' : '未打开';
  stepCount.textContent = String(state.stepCount ?? 0);
  screenshotCount.textContent = String(state.screenshotCount ?? 0);
  lastAction.textContent = state.lastAction || '-';
  exportPath.textContent = state.exportPath || '-';
  startButton.disabled = !state.isOpen || state.isRecording;
  stopButton.disabled = !state.isRecording;
  exportButton.disabled = !stopped;
}

async function run(action, success) {
  try {
    const result = await action();
    success?.(result);
    setLog('OK');
  } catch (error) {
    setLog(error.message || String(error));
  }
}

openButton.addEventListener('click', () => run(
  () => api.open(urlInput.value),
  (state) => render(state)
));

startButton.addEventListener('click', () => run(
  () => api.start(),
  (state) => {
    stopped = false;
    render(state);
  }
));

stopButton.addEventListener('click', () => run(
  () => api.stop(),
  (result) => {
    stopped = true;
    render(result.state);
    setLog(`已停止录制，flow 包含 ${result.flow.steps.length} 个步骤。`);
  }
));

exportButton.addEventListener('click', () => {
  const confirmed = confirm('.flow.zip 将包含页面截图。确认导出？');
  if (!confirmed) return;
  run(
    () => api.export({ name: flowName.value, notes: notes.value }),
    (state) => {
      render(state);
      setLog(`导出完成：${state.exportPath}`);
    }
  );
});

closeButton.addEventListener('click', () => run(
  () => api.closeBrowser(),
  (state) => {
    stopped = false;
    render(state);
  }
));

api.state().then(render);
