const DB_NAME = 'brain-memory';
const DB_VERSION = 4;
const EVENT_STORE = 'events';
const PAGE_STORE = 'pages';
const VISIT_STORE = 'visits';

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(EVENT_STORE)) db.createObjectStore(EVENT_STORE, { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
    if (!db.objectStoreNames.contains(PAGE_STORE)) {
      const store = db.createObjectStore(PAGE_STORE, { keyPath: 'id' });
      store.createIndex('url', 'url', { unique: true }); store.createIndex('lastSeenAt', 'lastSeenAt');
    }
    if (!db.objectStoreNames.contains(VISIT_STORE)) {
      const store = db.createObjectStore(VISIT_STORE, { keyPath: 'id' });
      store.createIndex('tabId', 'tabId'); store.createIndex('startedAt', 'startedAt'); store.createIndex('pageId', 'pageId');
    }
  };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});

const uuid = () => crypto.randomUUID();
function safeUrl(value) { try { const u = new URL(value); u.username = ''; u.password = ''; return u.toString(); } catch { return null; } }
async function put(storeName, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(value); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
}
async function getByIndex(storeName, indexName, value) {
  const db = await openDb();
  const result = await new Promise((resolve, reject) => { const r = db.transaction(storeName, 'readonly').objectStore(storeName).index(indexName).get(value); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  db.close(); return result;
}
async function count(storeName) {
  const db = await openDb();
  const n = await new Promise((resolve, reject) => { const r = db.transaction(storeName, 'readonly').objectStore(storeName).count(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  db.close(); return n;
}
async function all(storeName, limit = 100) {
  const db = await openDb();
  const rows = await new Promise((resolve, reject) => {
    const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    r.onsuccess = () => resolve(r.result.slice(-limit).reverse()); r.onerror = () => reject(r.error);
  }); db.close(); return rows;
}
async function event(type, data = {}) { await put(EVENT_STORE, { id: uuid(), type, timestamp: Date.now(), ...data }); }

async function endActiveVisit(tabId, endedAt = Date.now()) {
  const visit = await getByIndex(VISIT_STORE, 'tabId', tabId);
  if (visit && !visit.endedAt) { visit.endedAt = endedAt; visit.durationMs = Math.max(0, endedAt - visit.startedAt); await put(VISIT_STORE, visit); }
}

async function startVisit(tabId, url, title = '') {
  const clean = safeUrl(url); if (!clean || /^(chrome|edge|about|devtools):/i.test(clean)) return;
  const now = Date.now();
  await endActiveVisit(tabId, now);
  const existing = await getByIndex(PAGE_STORE, 'url', clean);
  const page = { id: existing?.id || uuid(), url: clean, title: title || existing?.title || clean, description: existing?.description || '', headings: existing?.headings || [], contentText: existing?.contentText || '', firstSeenAt: existing?.firstSeenAt || now, lastSeenAt: now, visitCount: (existing?.visitCount || 0) + 1, contentHash: existing?.contentHash };
  await put(PAGE_STORE, page);
  await put(VISIT_STORE, { id: uuid(), tabId, pageId: page.id, url: clean, title: page.title, startedAt: now, source: 'navigation' });
}

chrome.webNavigation.onCommitted.addListener(async d => { if (d.frameId === 0 && safeUrl(d.url)) await event('navigation', { tabId: d.tabId, url: safeUrl(d.url), transitionType: d.transitionType }); });
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = safeUrl(changeInfo.url || tab.url); if (!url) return;
  if (changeInfo.url || changeInfo.status === 'complete') { await event('tab_updated', { tabId, url, title: tab.title || '' }); await startVisit(tabId, url, tab.title || ''); }
  else if (changeInfo.title) { const page = await getByIndex(PAGE_STORE, 'url', url); if (page) { page.title = changeInfo.title; page.lastSeenAt = Date.now(); await put(PAGE_STORE, page); } }
});
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => { const tab = await chrome.tabs.get(tabId).catch(() => null); await event('tab_activated', { tabId, windowId, url: safeUrl(tab?.url), title: tab?.title || '' }); });
chrome.tabs.onRemoved.addListener(async (tabId, info) => { await endActiveVisit(tabId); await event('tab_removed', { tabId, windowId: info.windowId }); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PAGE_CAPTURE' && sender.tab?.id != null) {
    (async () => {
      const data = message.page || {}, url = safeUrl(data.url); if (!url) return { ok: false, error: 'Invalid URL' };
      const existing = await getByIndex(PAGE_STORE, 'url', url), now = Date.now();
      await put(PAGE_STORE, { id: existing?.id || uuid(), url, title: data.title || existing?.title || url, description: data.description || existing?.description || '', headings: data.headings || existing?.headings || [], contentText: data.contentText || existing?.contentText || '', firstSeenAt: existing?.firstSeenAt || now, lastSeenAt: now, visitCount: existing?.visitCount || 1, contentHash: existing?.contentHash });
      return { ok: true };
    })().then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message })); return true;
  }
  if (message?.type === 'GET_LOCAL_STATS') {
    Promise.all([count(EVENT_STORE), count(PAGE_STORE), count(VISIT_STORE)]).then(([events, pages, visits]) => sendResponse({ ok: true, events, pages, visits })).catch(e => sendResponse({ ok: false, error: e.message })); return true;
  }
  if (message?.type === 'GET_RECENT_MEMORY') {
    Promise.all([all(PAGE_STORE, 50), all(VISIT_STORE, 50), all(EVENT_STORE, 100)]).then(([pages, visits, events]) => sendResponse({ ok: true, pages, visits, events })).catch(e => sendResponse({ ok: false, error: e.message })); return true;
  }
});

chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}));
