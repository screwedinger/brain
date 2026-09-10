const DB_NAME = 'brain-memory';
const DB_VERSION = 5;
const EVENT_STORE = 'events';
const PAGE_STORE = 'pages';
const VISIT_STORE = 'visits';
const ACTIVE_STORE = 'activeVisits';

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(EVENT_STORE)) db.createObjectStore(EVENT_STORE, { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
    if (!db.objectStoreNames.contains(PAGE_STORE)) { const s = db.createObjectStore(PAGE_STORE, { keyPath: 'id' }); s.createIndex('url', 'url', { unique: true }); s.createIndex('lastSeenAt', 'lastSeenAt'); }
    if (!db.objectStoreNames.contains(VISIT_STORE)) { const s = db.createObjectStore(VISIT_STORE, { keyPath: 'id' }); s.createIndex('tabId', 'tabId'); s.createIndex('startedAt', 'startedAt'); s.createIndex('pageId', 'pageId'); }
    if (!db.objectStoreNames.contains(ACTIVE_STORE)) db.createObjectStore(ACTIVE_STORE, { keyPath: 'tabId' });
  };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
const uuid = () => crypto.randomUUID();
function safeUrl(value) { try { const u = new URL(value); u.username = ''; u.password = ''; return u.toString(); } catch { return null; } }
async function tx(store, mode, action) { const db = await openDb(); const result = await new Promise((resolve, reject) => { const t = db.transaction(store, mode); const r = action(t.objectStore(store)); if (r?.onsuccess !== undefined) { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); } else { t.oncomplete = () => resolve(r); t.onerror = () => reject(t.error); } }); db.close(); return result; }
async function put(store, value) { return tx(store, 'readwrite', s => s.put(value)); }
async function get(store, key) { return tx(store, 'readonly', s => s.get(key)); }
async function getIndex(store, index, value) { return tx(store, 'readonly', s => s.index(index).get(value)); }
async function count(store) { return tx(store, 'readonly', s => s.count()); }
async function all(store, limit = 100) { const rows = await tx(store, 'readonly', s => s.getAll()); return rows.sort((a,b) => (b.startedAt || b.timestamp || b.lastSeenAt || 0) - (a.startedAt || a.timestamp || a.lastSeenAt || 0)).slice(0, limit); }
async function event(type, data = {}) { await put(EVENT_STORE, { id: uuid(), type, timestamp: Date.now(), ...data }); }

async function endVisit(tabId, endedAt = Date.now()) {
  const active = await get(ACTIVE_STORE, tabId); if (!active) return;
  const visit = await get(VISIT_STORE, active.visitId);
  if (visit && !visit.endedAt) { visit.endedAt = endedAt; visit.durationMs = Math.max(0, endedAt - visit.startedAt); await put(VISIT_STORE, visit); }
  await tx(ACTIVE_STORE, 'readwrite', s => s.delete(tabId));
}
async function startVisit(tabId, url, title = '') {
  const clean = safeUrl(url); if (!clean || /^(chrome|edge|about|devtools|chrome-extension):/i.test(clean)) return;
  const existingActive = await get(ACTIVE_STORE, tabId);
  if (existingActive) { const activePage = await get(VISIT_STORE, existingActive.visitId); if (activePage?.url === clean) return; }
  await endVisit(tabId);
  const now = Date.now(); const existing = await getIndex(PAGE_STORE, 'url', clean);
  const page = { id: existing?.id || uuid(), url: clean, title: title || existing?.title || clean, description: existing?.description || '', headings: existing?.headings || [], contentText: existing?.contentText || '', firstSeenAt: existing?.firstSeenAt || now, lastSeenAt: now, visitCount: (existing?.visitCount || 0) + 1, contentHash: existing?.contentHash };
  await put(PAGE_STORE, page);
  const visit = { id: uuid(), tabId, pageId: page.id, url: clean, title: page.title, startedAt: now, source: 'navigation' };
  await put(VISIT_STORE, visit); await put(ACTIVE_STORE, { tabId, visitId: visit.id });
}

async function captureTab(tabId, tab) { if (!tab?.url || !safeUrl(tab.url)) return; await startVisit(tabId, tab.url, tab.title || ''); try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch {} }
async function captureOpenTabs() { const tabs = await chrome.tabs.query({}); await Promise.all(tabs.map(t => captureTab(t.id, t))); }
async function importHistory() {
  const imported = await chrome.storage.local.get('brainHistoryImported'); if (imported.brainHistoryImported) return;
  const items = await chrome.history.search({ text: '', startTime: Date.now() - 7 * 24 * 60 * 60 * 1000, maxResults: 500 });
  for (const item of items) { const url = safeUrl(item.url); if (!url) continue; const now = item.lastVisitTime || Date.now(); const existing = await getIndex(PAGE_STORE, 'url', url); await put(PAGE_STORE, { id: existing?.id || uuid(), url, title: item.title || existing?.title || url, description: existing?.description || '', headings: existing?.headings || [], contentText: existing?.contentText || '', firstSeenAt: existing?.firstSeenAt || (item.lastVisitTime || now), lastSeenAt: now, visitCount: Math.max(existing?.visitCount || 0, item.visitCount || 1), contentHash: existing?.contentHash }); }
  await chrome.storage.local.set({ brainHistoryImported: true });
}

chrome.webNavigation.onCommitted.addListener(async d => { if (d.frameId === 0) await event('navigation', { tabId: d.tabId, url: safeUrl(d.url), transitionType: d.transitionType }); });
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => { if (changeInfo.url) { await event('tab_updated', { tabId, url: safeUrl(changeInfo.url), title: tab.title || '' }); await captureTab(tabId, tab); } else if (changeInfo.status === 'complete') { await captureTab(tabId, tab); } else if (changeInfo.title && tab.url) { const page = await getIndex(PAGE_STORE, 'url', safeUrl(tab.url)); if (page) { page.title = changeInfo.title; page.lastSeenAt = Date.now(); await put(PAGE_STORE, page); } } });
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => { const tab = await chrome.tabs.get(tabId).catch(() => null); await event('tab_activated', { tabId, windowId, url: safeUrl(tab?.url), title: tab?.title || '' }); if (tab) await captureTab(tabId, tab); });
chrome.tabs.onRemoved.addListener(async (tabId, info) => { await endVisit(tabId); await event('tab_removed', { tabId, windowId: info.windowId }); });
chrome.runtime.onStartup.addListener(async () => { await importHistory(); await captureOpenTabs(); });
chrome.runtime.onInstalled.addListener(async () => { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); await importHistory(); await captureOpenTabs(); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PAGE_CAPTURE') { (async () => { const data = message.page || {}, url = safeUrl(data.url); if (!url) return { ok:false }; const existing = await getIndex(PAGE_STORE, 'url', url), now = Date.now(); await put(PAGE_STORE, { id: existing?.id || uuid(), url, title: data.title || existing?.title || url, description: data.description || existing?.description || '', headings: data.headings || existing?.headings || [], contentText: data.contentText || existing?.contentText || '', firstSeenAt: existing?.firstSeenAt || now, lastSeenAt: now, visitCount: existing?.visitCount || 1, contentHash: data.contentHash || existing?.contentHash }); return { ok:true }; })().then(sendResponse).catch(e => sendResponse({ok:false,error:e.message})); return true; }
  if (message?.type === 'GET_RECENT_MEMORY') { Promise.all([count(EVENT_STORE),count(PAGE_STORE),count(VISIT_STORE),all(PAGE_STORE,50),all(VISIT_STORE,50),all(EVENT_STORE,100)]).then(([eventsCount,pagesCount,visitsCount,pages,visits,events]) => sendResponse({ok:true,eventsCount,pagesCount,visitsCount,pages,visits,events})).catch(e=>sendResponse({ok:false,error:e.message})); return true; }
});
