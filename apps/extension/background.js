const DB_NAME = 'brain-memory';
const DB_VERSION = 1;
const STORE = 'events';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function record(event) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(event);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function id() {
  return crypto.randomUUID();
}

function safeUrl(url) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    // Never persist URL credentials. Query strings are intentionally retained
    // for now because Brain's first milestone is complete browser recall.
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

async function captureTab(tab, type) {
  if (!tab?.url || !safeUrl(tab.url)) return;
  await record({
    id: id(),
    type,
    timestamp: Date.now(),
    tabId: tab.id,
    windowId: tab.windowId,
    url: safeUrl(tab.url),
    title: tab.title || ''
  });
}

chrome.tabs.onCreated.addListener((tab) => captureTab(tab, 'tab_created'));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    captureTab(tab, 'tab_updated');
  }
});
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await captureTab(tab, 'tab_activated');
  await record({ id: id(), type: 'tab_activated', timestamp: Date.now(), tabId, windowId });
});
chrome.tabs.onRemoved.addListener((tabId, removeInfo) =>
  record({ id: id(), type: 'tab_removed', timestamp: Date.now(), tabId, windowId: removeInfo.windowId })
);
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  record({
    id: id(),
    type: 'navigation',
    timestamp: Date.now(),
    tabId: details.tabId,
    url: safeUrl(details.url),
    transitionType: details.transitionType
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_LOCAL_STATS') {
    openDb().then(async (db) => {
      const count = await new Promise((resolve, reject) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      sendResponse({ ok: true, events: count });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
