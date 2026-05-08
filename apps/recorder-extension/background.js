const DEFAULT_RECEIVER_URL = 'http://127.0.0.1:17321';

async function getConfig() {
  const stored = await chrome.storage.local.get({
    receiverUrl: DEFAULT_RECEIVER_URL,
    token: '',
    enabled: true
  });
  return {
    receiverUrl: String(stored.receiverUrl || DEFAULT_RECEIVER_URL).replace(/\/+$/, ''),
    token: String(stored.token || ''),
    enabled: Boolean(stored.enabled)
  };
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text }).catch(() => undefined);
  await chrome.action.setBadgeBackgroundColor({ color }).catch(() => undefined);
}

async function captureVisibleScreenshot(sender) {
  if (!sender.tab || typeof sender.tab.windowId !== 'number') return '';
  try {
    return await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
  } catch {
    return '';
  }
}

async function postEvent(event, sender) {
  const config = await getConfig();
  if (!config.enabled || !config.token) {
    await setBadge('off', '#64748b');
    return { ok: false, skipped: true };
  }

  const screenshotDataUrl = await captureVisibleScreenshot(sender);
  const payload = {
    ...event,
    screenshotDataUrl,
    source: 'chrome-extension',
    tabId: sender.tab?.id,
    frameId: sender.frameId
  };

  const response = await fetch(`${config.receiverUrl}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-autochar-token': config.token
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    await setBadge('err', '#dc2626');
    return { ok: false, status: response.status };
  }
  await setBadge('rec', '#16a34a');
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.kind !== 'autochar-event') return false;
  postEvent(message.event, sender)
    .then(sendResponse)
    .catch((error) => {
      setBadge('err', '#dc2626').catch(() => undefined);
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});
