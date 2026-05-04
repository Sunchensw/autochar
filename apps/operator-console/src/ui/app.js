const api = window.autocharOwner;
const importButton = document.querySelector('#importButton');
const validationState = document.querySelector('#validationState');
const validationIssues = document.querySelector('#validationIssues');
const riskSummary = document.querySelector('#riskSummary');
const stepsBody = document.querySelector('#stepsBody');
const screenshot = document.querySelector('#screenshot');
const generateButton = document.querySelector('#generateButton');
const selectInputButton = document.querySelector('#selectInputButton');
const dryRunButton = document.querySelector('#dryRunButton');
const runButton = document.querySelector('#runButton');
const scriptPath = document.querySelector('#scriptPath');
const inputPath = document.querySelector('#inputPath');
const maxRows = document.querySelector('#maxRows');
const startRow = document.querySelector('#startRow');
const failFast = document.querySelector('#failFast');
const formalConfirm = document.querySelector('#formalConfirm');
const resultsBody = document.querySelector('#resultsBody');
const log = document.querySelector('#log');

let flowValid = false;
let scriptReady = false;
let inputReady = false;
let dryRunDone = false;

function setLog(message) {
  log.textContent = message;
}

function options() {
  return {
    maxRows: Number(maxRows.value || 3),
    startRow: Number(startRow.value || 1),
    failFast: failFast.checked
  };
}

function refreshButtons() {
  generateButton.disabled = !flowValid;
  selectInputButton.disabled = !flowValid;
  dryRunButton.disabled = !flowValid || !scriptReady || !inputReady;
  runButton.disabled = !flowValid || !scriptReady || !inputReady || !dryRunDone || !formalConfirm.checked;
}

function renderResults(results) {
  resultsBody.innerHTML = '';
  for (const result of results) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${result.row}</td>
      <td>${result.status}</td>
      <td>${result.message}</td>
      <td>${result.screenshot || ''}</td>
      <td>${result.durationMs}</td>
    `;
    resultsBody.append(row);
  }
}

function renderImport(summary) {
  flowValid = Boolean(summary.validation.ok);
  scriptReady = false;
  inputReady = false;
  dryRunDone = false;
  validationState.textContent = summary.validation.ok ? `通过：${summary.flowName}` : `失败：${summary.flowName}`;
  validationIssues.innerHTML = '';
  for (const issue of [...summary.validation.errors, ...summary.validation.warnings]) {
    const li = document.createElement('li');
    li.textContent = issue;
    validationIssues.append(li);
  }
  riskSummary.textContent = `高风险步骤 ${summary.highRiskCount} 个；敏感步骤 ${summary.sensitiveCount} 个。敏感数据不会明文导出。`;
  stepsBody.innerHTML = '';
  for (const step of summary.steps) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${step.id}</td>
      <td>${step.type}</td>
      <td>${step.label}</td>
      <td>${step.selector}</td>
      <td>${step.sensitive ? '是' : '否'}</td>
      <td>${step.highRisk ? '是' : '否'}</td>
    `;
    row.addEventListener('click', () => {
      screenshot.src = step.screenshotUrl || '';
      screenshot.dataset.path = step.screenshotPath || '';
    });
    stepsBody.append(row);
  }
  scriptPath.textContent = '未生成';
  inputPath.textContent = '未选择';
  refreshButtons();
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

importButton.addEventListener('click', () => run(api.importFlow, (summary) => {
  if (summary) renderImport(summary);
}));

generateButton.addEventListener('click', () => run(api.generateScript, (result) => {
  scriptReady = true;
  scriptPath.textContent = `${result.tsPath}\n${result.mjsPath}`;
  refreshButtons();
}));

selectInputButton.addEventListener('click', () => run(api.selectInput, (selected) => {
  if (!selected) return;
  inputReady = true;
  inputPath.textContent = selected;
  refreshButtons();
}));

dryRunButton.addEventListener('click', () => run(() => api.runDryRun(options()), (results) => {
  dryRunDone = true;
  renderResults(results);
  refreshButtons();
}));

runButton.addEventListener('click', () => run(
  () => api.runBatch({ ...options(), confirmed: formalConfirm.checked }),
  (results) => renderResults(results)
));

formalConfirm.addEventListener('change', refreshButtons);
maxRows.addEventListener('input', refreshButtons);
startRow.addEventListener('input', refreshButtons);
failFast.addEventListener('change', refreshButtons);
