import { chromium } from 'playwright';

const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const port = Number(portArg?.slice('--port='.length) || process.env.AUTOCHAR_REMOTE_DEBUG_PORT || 9223);
const endpoint = `http://127.0.0.1:${port}`;

function summarizeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function frameStatus(frame) {
  const url = frame.url();
  try {
    const status = await frame.evaluate(() => {
      const text = (node) => ((node && (node.innerText || node.textContent)) || '').replace(/\s+/g, ' ').trim();
      const attr = (node, name) => (node && node.getAttribute && node.getAttribute(name)) || '';
      const candidates = Array.from(document.querySelectorAll([
        'button',
        'a[href]',
        'input',
        'textarea',
        'select',
        '[role]',
        '[onclick]',
        '[tabindex]:not([tabindex="-1"])',
        '[aria-haspopup]',
        '[aria-expanded]',
        '[data-testid]',
        '[data-test]',
        '[data-qa]'
      ].join(','))).slice(0, 60).map((node) => ({
        tag: node.tagName,
        id: attr(node, 'id'),
        role: attr(node, 'role'),
        type: attr(node, 'type'),
        text: text(node).slice(0, 80),
        placeholder: attr(node, 'placeholder'),
        ariaLabel: attr(node, 'aria-label'),
        testId: attr(node, 'data-testid') || attr(node, 'data-test') || attr(node, 'data-qa')
      }));
      const shadowHosts = [];
      const scan = (root) => {
        for (const node of Array.from(root.querySelectorAll('*'))) {
          if (node.shadowRoot) {
            shadowHosts.push({
              tag: node.tagName,
              id: attr(node, 'id'),
              role: attr(node, 'role'),
              text: text(node).slice(0, 80)
            });
            scan(node.shadowRoot);
          }
        }
      };
      scan(document);
      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        hasAutocharBinding: typeof window.__autocharCapture === 'function',
        captureInstalled: Boolean(window.__autocharCaptureInstalled),
        candidateCount: candidates.length,
        candidates,
        shadowHostCount: shadowHosts.length,
        shadowHosts: shadowHosts.slice(0, 30)
      };
    });
    return { url, ok: true, ...status };
  } catch (error) {
    return { url, ok: false, error: summarizeError(error) };
  }
}

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint);
  } catch (error) {
    console.error(`Cannot connect to Autochar Recorder Chromium at ${endpoint}`);
    console.error(summarizeError(error));
    process.exit(2);
  }

  const pages = browser.contexts().flatMap((context) => context.pages());
  const result = [];
  for (const page of pages) {
    result.push({
      url: page.url(),
      title: await page.title().catch(() => ''),
      frames: await Promise.all(page.frames().map(frameStatus))
    });
  }
  console.log(JSON.stringify({ endpoint, pageCount: pages.length, pages: result }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(summarizeError(error));
  process.exit(1);
});
