import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Divider,
  FluentProvider,
  Input,
  Link,
  Switch,
  Text,
  Textarea,
  Title2,
  Title3,
  Tooltip,
  webDarkTheme,
  webLightTheme
} from '@fluentui/react-components';
import {
  ArrowDownload24Regular,
  Bug24Regular,
  Desktop24Regular,
  Document24Regular,
  Home24Regular,
  Open24Regular,
  PuzzlePiece24Regular,
  Record24Regular,
  Settings24Regular,
  Shield24Regular,
  Stop24Regular
} from '@fluentui/react-icons';
import type { ExtensionInfo, RecordingState } from './types';

type ViewKey = 'dashboard' | 'extension' | 'chromium' | 'document' | 'logs';
type ThemeMode = 'system' | 'light' | 'dark';

const initialState: RecordingState = {
  isOpen: false,
  isRecording: false,
  stepCount: 0,
  screenshotCount: 0,
  notes: [],
  debugLog: []
};

const navItems: Array<{ key: ViewKey; label: string; icon: ReactElement }> = [
  { key: 'dashboard', label: 'Dashboard', icon: <Home24Regular /> },
  { key: 'extension', label: '扩展录制', icon: <PuzzlePiece24Regular /> },
  { key: 'chromium', label: 'Chromium 录制', icon: <Desktop24Regular /> },
  { key: 'document', label: 'AI 文档', icon: <Document24Regular /> },
  { key: 'logs', label: '调试日志', icon: <Bug24Regular /> }
];

const viewTitles: Record<ViewKey, string> = {
  dashboard: 'Dashboard',
  extension: '扩展录制',
  chromium: 'Chromium 录制',
  document: 'AI 文档',
  logs: '调试日志'
};

function useSystemDark() {
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const listener = (event: MediaQueryListEvent) => setDark(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  return dark;
}

function statusBadge(state: RecordingState) {
  if (state.isRecording) return <Badge appearance="filled" color="danger">录制中</Badge>;
  if (state.exportPath) return <Badge appearance="filled" color="success">已导出</Badge>;
  if (state.isOpen) return <Badge appearance="filled" color="warning">已停止</Badge>;
  return <Badge appearance="filled" color="subtle">待开始</Badge>;
}

function metric(label: string, value: string | number) {
  return (
    <div className="metric">
      <Text size={200}>{label}</Text>
      <Text size={600} weight="semibold">{value}</Text>
    </div>
  );
}

function logText(state: RecordingState) {
  return state.debugLog.length ? state.debugLog.join('\n') : '暂无调试日志。';
}

export function App() {
  const [view, setView] = useState<ViewKey>('dashboard');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('autochar-theme') as ThemeMode | null;
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });
  const systemDark = useSystemDark();
  const [state, setState] = useState<RecordingState>(initialState);
  const [extension, setExtension] = useState<ExtensionInfo>();
  const [startUrl, setStartUrl] = useState('https://');
  const [flowName, setFlowName] = useState('Autochar Recording');
  const [notes, setNotes] = useState('');
  const [operationMarkdown, setOperationMarkdown] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const theme = themeMode === 'dark' || (themeMode === 'system' && systemDark) ? webDarkTheme : webLightTheme;
  const api = window.autocharRecorder;

  useEffect(() => {
    localStorage.setItem('autochar-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const next = await api.state();
        if (alive) setState(next);
      } catch {
        // The app may still be booting. The next poll will try again.
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 1600);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [api]);

  const canExport = useMemo(() => !state.isRecording && state.isOpen && operationMarkdown.trim().length > 0, [state, operationMarkdown]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshExtensionInfo() {
    const info = await api.extensionInfo();
    setExtension(info);
  }

  async function startExtensionRecording() {
    const next = await api.startExtension();
    setState(next);
    setExtension(next.extension);
    setOperationMarkdown('');
  }

  async function startChromiumRecording() {
    const next = await api.open(startUrl);
    setState(next);
    setOperationMarkdown('');
  }

  async function stopRecording() {
    const result = await api.stop();
    setState(result.state);
    setOperationMarkdown(result.operationMarkdown || '');
    setView('document');
  }

  async function exportMarkdown() {
    const next = await api.export({ name: flowName, notes });
    setState(next);
    if (next.operationMarkdown) setOperationMarkdown(next.operationMarkdown);
  }

  async function exportMaterials() {
    const next = await api.exportMaterials({ name: flowName, notes });
    setState(next);
  }

  async function closeRecorder() {
    const next = await api.closeBrowser();
    setState(next);
    setOperationMarkdown('');
  }

  const renderDashboard = () => (
    <div className="dashboardGrid">
      <Card className="dashCard">
        <CardHeader
          image={<Record24Regular />}
          header={<Text weight="semibold">录制状态</Text>}
          description={<Text size={200}>用户只需要录制并导出 AI 文档</Text>}
        />
        <div className="metricGrid">
          {metric('步骤', state.stepCount)}
          {metric('截图缓存', state.screenshotCount)}
          {metric('最近动作', state.lastAction || '-')}
        </div>
        <div className="buttonRow">
          <Button appearance="primary" icon={<PuzzlePiece24Regular />} onClick={() => setView('extension')}>扩展录制</Button>
          <Button icon={<Desktop24Regular />} onClick={() => setView('chromium')}>Chromium 录制</Button>
        </div>
      </Card>

      <Card className="dashCard">
        <CardHeader
          image={<Document24Regular />}
          header={<Text weight="semibold">AI 文档</Text>}
          description={<Text size={200}>停止录制后生成单个 .autochar.md</Text>}
        />
        <Text className="pathText">{state.exportPath || '尚未导出'}</Text>
        <Text className="pathText">{state.materialPackagePath || '材料包尚未导出'}</Text>
        <div className="buttonRow">
          <Button appearance="primary" icon={<ArrowDownload24Regular />} disabled={!canExport || busy} onClick={() => run(exportMarkdown)}>导出文档</Button>
          <Button icon={<ArrowDownload24Regular />} disabled={!canExport || busy} onClick={() => run(exportMaterials)}>导出材料包</Button>
          <Button icon={<Document24Regular />} disabled={!operationMarkdown} onClick={() => setView('document')}>查看预览</Button>
        </div>
      </Card>

      <Card className="dashCard">
        <CardHeader
          image={<Shield24Regular />}
          header={<Text weight="semibold">安全边界</Text>}
          description={<Text size={200}>参照 Crawl4AI 的默认安全收敛</Text>}
        />
        <ul className="compactList">
          <li>只允许 http、https、raw 页面来源。</li>
          <li>不导出密码值、验证码值、令牌或浏览器存储。</li>
          <li>hooks、自定义脚本、stealth、proxy 默认禁用。</li>
          <li>验证码、风控、登录失效会记录为人工介入。</li>
        </ul>
      </Card>
    </div>
  );

  const renderExtension = () => (
    <div className="contentStack">
      <Card>
        <CardHeader
          image={<PuzzlePiece24Regular />}
          header={<Text weight="semibold">用户浏览器扩展录制</Text>}
          description={<Text size={200}>适合京东、唯品会、抖店等用户已登录后台</Text>}
        />
        <div className="formGrid">
          <div className="fieldWide">
            <Text size={200} weight="semibold">流程名</Text>
            <Input value={flowName} onChange={(_, data) => setFlowName(data.value)} />
          </div>
          <div className="fieldWide">
            <Text size={200} weight="semibold">备注</Text>
            <Textarea value={notes} onChange={(_, data) => setNotes(data.value)} resize="vertical" />
          </div>
        </div>
        <div className="buttonRow">
          <Button icon={<Open24Regular />} onClick={() => run(refreshExtensionInfo)}>获取扩展连接信息</Button>
          <Button icon={<Open24Regular />} onClick={() => run(api.openExtensionFolder)}>打开扩展目录</Button>
          <Button appearance="primary" icon={<Record24Regular />} disabled={state.isRecording || busy} onClick={() => run(startExtensionRecording)}>开始扩展录制</Button>
          <Button icon={<Stop24Regular />} disabled={!state.isRecording || busy} onClick={() => run(stopRecording)}>停止录制</Button>
        </div>
      </Card>

      <Card>
        <CardHeader header={<Text weight="semibold">扩展配置</Text>} />
        <div className="infoGrid">
          {metric('Receiver', extension?.receiverUrl || '-')}
          {metric('Token', extension?.token || '-')}
          {metric('目录', extension?.extensionDir || '-')}
        </div>
      </Card>
    </div>
  );

  const renderChromium = () => (
    <div className="contentStack">
      <Card>
        <CardHeader
          image={<Desktop24Regular />}
          header={<Text weight="semibold">受控 Chromium 录制</Text>}
          description={<Text size={200}>仅打开 http、https、raw 页面来源</Text>}
        />
        <div className="formGrid">
          <div className="fieldWide">
            <Text size={200} weight="semibold">起始 URL</Text>
            <Input value={startUrl} onChange={(_, data) => setStartUrl(data.value)} />
          </div>
          <div className="fieldWide">
            <Text size={200} weight="semibold">流程名</Text>
            <Input value={flowName} onChange={(_, data) => setFlowName(data.value)} />
          </div>
          <div className="fieldWide">
            <Text size={200} weight="semibold">备注</Text>
            <Textarea value={notes} onChange={(_, data) => setNotes(data.value)} resize="vertical" />
          </div>
        </div>
        <div className="buttonRow">
          <Button appearance="primary" icon={<Record24Regular />} disabled={state.isRecording || busy} onClick={() => run(startChromiumRecording)}>打开并录制</Button>
          <Button icon={<Stop24Regular />} disabled={!state.isRecording || busy} onClick={() => run(stopRecording)}>停止录制</Button>
          <Button icon={<Desktop24Regular />} disabled={!state.isOpen || busy} onClick={() => run(closeRecorder)}>关闭浏览器</Button>
        </div>
      </Card>
    </div>
  );

  const renderDocument = () => (
    <div className="documentGrid">
      <Card className="documentControls">
        <CardHeader
          image={<Document24Regular />}
          header={<Text weight="semibold">Markdown 输出</Text>}
          description={<Text size={200}>最终只导出一个 AI 易懂的文档</Text>}
        />
        <Text size={200} weight="semibold">流程名</Text>
        <Input value={flowName} onChange={(_, data) => setFlowName(data.value)} />
        <Text size={200} weight="semibold">备注</Text>
        <Textarea value={notes} onChange={(_, data) => setNotes(data.value)} resize="vertical" />
        <Button appearance="primary" icon={<ArrowDownload24Regular />} disabled={!canExport || busy} onClick={() => run(exportMarkdown)}>导出 .autochar.md</Button>
        <Button icon={<ArrowDownload24Regular />} disabled={!canExport || busy} onClick={() => run(exportMaterials)}>导出电商材料包</Button>
        <Text className="pathText">{state.exportPath || '停止录制后可导出文档。'}</Text>
        <Text className="pathText">{state.materialPackagePath || '材料包会包含 流程说明.md、field-dictionary.json、字段模板.xlsx。'}</Text>
      </Card>
      <Card className="previewCard">
        <Textarea
          className="markdownPreview"
          value={operationMarkdown || '停止录制后会在这里显示 Autochar AI Operation Document。'}
          readOnly
          resize="none"
        />
      </Card>
    </div>
  );

  const renderLogs = () => (
    <Card className="logsCard">
      <CardHeader
        image={<Bug24Regular />}
        header={<Text weight="semibold">调试日志</Text>}
        description={<Text size={200}>{state.debugLogPath || '当前会话日志'}</Text>}
      />
      <Textarea className="logPreview" value={logText(state)} readOnly resize="none" />
    </Card>
  );

  const renderContent = () => {
    if (view === 'extension') return renderExtension();
    if (view === 'chromium') return renderChromium();
    if (view === 'document') return renderDocument();
    if (view === 'logs') return renderLogs();
    return renderDashboard();
  };

  return (
    <FluentProvider theme={theme}>
      <div className="appShell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brandMark">A</div>
            <div>
              <Text weight="semibold">Autochar</Text>
              <Text size={200}>Recorder</Text>
            </div>
          </div>

          <nav className="navList">
            {navItems.map((item) => (
              <Tooltip key={item.key} content={item.label} relationship="label">
                <Button
                  appearance={view === item.key ? 'primary' : 'subtle'}
                  icon={item.icon}
                  onClick={() => setView(item.key)}
                  className="navButton"
                >
                  {item.label}
                </Button>
              </Tooltip>
            ))}
          </nav>

          <div className="settingsPanel">
            <Divider />
            <div className="settingsTitle">
              <Settings24Regular />
              <Text weight="semibold">设置</Text>
            </div>
            <Switch
              checked={themeMode === 'dark'}
              label={themeMode === 'dark' ? '深色主题' : '浅色主题'}
              onChange={(_, data) => setThemeMode(data.checked ? 'dark' : 'light')}
            />
            <Button size="small" appearance="subtle" icon={<Shield24Regular />} onClick={() => setView('dashboard')}>
              安全边界
            </Button>
            <Link onClick={() => setThemeMode('system')}>跟随系统</Link>
          </div>
        </aside>

        <main className="mainPane">
          <header className="topBar">
            <div>
              <Title2>{viewTitles[view]}</Title2>
              <Text size={200}>当前模块标题和录制状态</Text>
            </div>
            <div className="statusCluster">
              {statusBadge(state)}
              {busy ? <Badge appearance="filled" color="brand">处理中</Badge> : null}
            </div>
          </header>

          {error ? <div className="errorBanner"><Text weight="semibold">操作失败</Text><Text>{error}</Text></div> : null}

          <section className="contentPane">
            {renderContent()}
          </section>
        </main>
      </div>
    </FluentProvider>
  );
}
