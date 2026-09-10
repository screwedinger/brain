const DB_NAME = 'brain-memory';
const DB_VERSION = 2;
const EVENT_STORE = 'events';
const PAGE_STORE = 'pages';
const VISIT_STORE = 'visits';

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(EVENT_STORE)) {
      const store = db.createObjectStore(EVENT_STORE, { keyPath: 'id' });
      store.createIndex('timestamp', 'timestamp');
    }
    if (!db.objectStoreNames.contains(PAGE_STORE)) {
      const store = db.createObjectStore(PAGE_STORE, { keyPath: 'id' });
      store.createIndex('url', 'url', { unique: true });
      store.createIndex('lastSeenAt', 'lastSeenAt');
    }
    if (!db.objectStoreNames.contains(VISIT_STORE)) {
      const store = db.createObjectStore(VISIT_STORE, { keyPath: 'id' });
      store.createIndex('tabId', 'tabId');
      store.createIndex('startedAt', 'startedAt');
      store.createIndex('pageId', 'pageId');
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const uuid = () => crypto.randomUUID();

function safeUrl(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch { return undefined; }
}

async function put(storeName, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getByIndex(storeName, indexName, value) {
  const db = await openDb();
  const result = await new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).index(indexName).get(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function recordEvent(event) {
  await put(EVENT_STORE, { id: uuid(), timestamp: Date.now(), ...event });
}

// A visit begins when a committed top-level navigation arrives. We keep the
// active visit in storage so the MV3 service worker can safely restart.
async function startVisit(tabId, url, title = '') {
  const cleanUrl = safeUrl(url);
  if (!cleanUrl) return;
  const page = await getByIndex(PAGE_STORE, 'url', cleanUrl);
  const pageId = page?.id || uuid();
  const now = Date.now();

  await put(PAGE_STORE, {
    id: pageId,
    url: cleanUrl,
    title: title || page?.title || cleanUrl,
    description: page?.description || '',
    headings: page?.headings || [],
    firstSeenAt: page?.firstSeenAt || now,
    lastSeenAt: now,
    visitCount: (page?.visitCount || 0) + 1,
    contentText: page?.contentText,
    contentHash: page?.contentHash
  });

  // End any unfinished visit for this tab before opening the next one.
  const previous = await getByIndex(VISIT_STORE, 'tabId', tabId);
  if (previous && !previous.endedAt) {
    previous.endedAt = now;
    previous.durationMs = Math.max(0, now - previous.startedAt);
    await put(VISIT_STORE, previous);
  }

  await put(VISIT_STORE, {
    id: uuid(),
    tabId,
    pageId,
    startedAt: now,
    source: 'navigation'
  });
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const url = safeUrl(details.url);
  if (!url) return;
  await recordEvent({ type: 'navigation', tabId: details.tabId, url, transitionType: details.transitionType });
  const tab = await chrome.tabs.get(details.tabId).catch(() => null);
  await startVisit(details.tabId, url, tab?.title || '');
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await recordEvent({ type: 'tab_activated', tabId, windowId, url: safeUrl(tab?.url), title: tab?.title || '' });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.title && tab.url) {
    const page = await getByIndex(PAGE_STORE, 'url', safeUrl(tab.url));
    if (page) { page.title = changeInfo.title; await put(PAGE_STORE, page); }
  }
  if (changeInfo.url) {
    await recordEvent({ type: 'tab_updated', tabId, url: safeUrl(changeInfo.url), title: tab.title || '' });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const previous = await getByIndex(VISIT_STORE, 'tabId', tabId);
  if (previous && !previous.endedAt) {
    previous.endedAt = Date.now();
    previous.durationMs = Math.max(0, previous.endedAt - previous.startedAt);
    await put(VISIT_STORE, previous);
  }
  await recordEvent({ type: 'tab_removed', tabId, windowId: removeInfo.windowId });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PAGE_CAPTURE' && sender.tab?.id != null) {
    (async () => {
      const pageData = message.page || {};
      const url = safeUrl(pageData.url);
      if (!url) return { ok: false, error: 'Invalid URL' };
      const existing = await getByIndex(PAGE_STORE, 'url', url);
      const now = Date.now();
      await put(PAGE_STORE, {
        id: existing?.id || uuid(),
        url,
        title: pageData.title || existing?.title || url,
        description: pageData.description || existing?.description || '',
        headings: pageData.headings || existing?.headings || [],
        contentText: pageData.contentText || existing?.contentText || '',
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: existing?.lastSeenAt || now,
        visitCount: existing?.visitCount || 1,
        contentHash: existing?.contentHash
      });
      return { ok: true };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_LOCAL_STATS') {
    (async () => {
      const db = await openDb();
      const counts = await Promise.all([EVENT_STORE, PAGE_STORE, VISIT_STORE].map((store) => new Promise((resolve, reject) => {
        const request = db.transaction(store, 'readonly').objectStore(store).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })));
      db.close();
      return { ok: true, events: counts[0], pages: counts[1], visits: counts[2] };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
