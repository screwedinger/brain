const DB_NAME = 'brain-memory';
const DB_VERSION = 6;
const EVENT_STORE = 'events';
const PAGE_STORE = 'pages';
const VISIT_STORE = 'visits';
const ACTIVE_STORE = 'activeVisits';
const STATE_STORE = 'state';

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(EVENT_STORE)) {
      const s = db.createObjectStore(EVENT_STORE, { keyPath: 'id' });
      s.createIndex('timestamp', 'timestamp');
    }
    if (!db.objectStoreNames.contains(PAGE_STORE)) {
      const s = db.createObjectStore(PAGE_STORE, { keyPath: 'id' });
      s.createIndex('url', 'url', { unique: true });
      s.createIndex('lastSeenAt', 'lastSeenAt');
    }
    if (!db.objectStoreNames.contains(VISIT_STORE)) {
      const s = db.createObjectStore(VISIT_STORE, { keyPath: 'id' });
      s.createIndex('tabId', 'tabId');
      s.createIndex('startedAt', 'startedAt');
      s.createIndex('pageId', 'pageId');
      s.createIndex('historyVisitId', 'historyVisitId', { unique: false });
    }
    if (!db.objectStoreNames.contains(ACTIVE_STORE)) db.createObjectStore(ACTIVE_STORE, { keyPath: 'tabId' });
    if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE, { keyPath: 'key' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const uuid = () => crypto.randomUUID();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function safeUrl(value) {
  try {
    const u = new URL(value);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return null;
  }
}

function isTrackableUrl(url) {
  return !!url && !/^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(url);
}

async function tx(store, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    if (request && typeof request.onsuccess !== 'undefined') {
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    } else {
      transaction.oncomplete = () => { db.close(); resolve(request); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    }
  });
}

async function put(store, value) { return tx(store, 'readwrite', s => s.put(value)); }
async function get(store, key) { return tx(store, 'readonly', s => s.get(key)); }
async function getIndex(store, index, value) { return tx(store, 'readonly', s => s.index(index).get(value)); }
async function count(store) { return tx(store, 'readonly', s => s.count()); }
async function all(store, limit = 100) {
  const rows = await tx(store, 'readonly', s => s.getAll());
  return rows
    .sort((a, b) => (b.startedAt || b.timestamp || b.lastSeenAt || 0) - (a.startedAt || a.timestamp || a.lastSeenAt || 0))
    .slice(0, limit);
}
async function event(type, data = {}) {
  await put(EVENT_STORE, { id: uuid(), type, timestamp: Date.now(), ...data });
}

const tabLocks = new Map();
function lockTab(tabId, work) {
  const previous = tabLocks.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  tabLocks.set(tabId, next.finally(() => {
    if (tabLocks.get(tabId) === next) tabLocks.delete(tabId);
  }));
  return next;
}

async function endVisit(tabId, endedAt = Date.now()) {
  const active = await get(ACTIVE_STORE, tabId);
  if (!active) return null;
  const visit = await get(VISIT_STORE, active.visitId);
  if (visit && !visit.endedAt) {
    visit.endedAt = endedAt;
    visit.durationMs = Math.max(0, endedAt - visit.startedAt);
    await put(VISIT_STORE, visit);
  }
  await tx(ACTIVE_STORE, 'readwrite', s => s.delete(tabId));
  return visit || null;
}

async function endCurrentVisit(endedAt = Date.now()) {
  const focus = await get(STATE_STORE, 'focus');
  if (!focus?.tabId) return;
  await endVisit(focus.tabId, endedAt);
  await tx(STATE_STORE, 'readwrite', s => s.delete('focus'));
}

async function startVisit(tabId, url, title = '', windowId, transitionType = 'link') {
  const clean = safeUrl(url);
  if (!isTrackableUrl(clean)) return null;

  const existingActive = await get(ACTIVE_STORE, tabId);
  if (existingActive) {
    const activeVisit = await get(VISIT_STORE, existingActive.visitId);
    if (activeVisit?.url === clean && !activeVisit.endedAt) return activeVisit;
    await endVisit(tabId);
  }

  await endCurrentVisit();

  const now = Date.now();
  const existing = await getIndex(PAGE_STORE, 'url', clean);
  const page = {
    id: existing?.id || uuid(),
    url: clean,
    title: title || existing?.title || clean,
    description: existing?.description || '',
    headings: existing?.headings || [],
    contentText: existing?.contentText || '',
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    visitCount: (existing?.visitCount || 0) + 1,
    contentHash: existing?.contentHash || undefined
  };
  await put(PAGE_STORE, page);

  const visit = {
    id: uuid(),
    tabId,
    windowId,
    pageId: page.id,
    url: clean,
    title: page.title,
    startedAt: now,
    source: 'navigation',
    transitionType
  };
  await put(VISIT_STORE, visit);
  await put(ACTIVE_STORE, { tabId, visitId: visit.id });
  await put(STATE_STORE, { key: 'focus', tabId, windowId });
  return visit;
}

async function capturePage(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'BRAIN_CAPTURE_PAGE' });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await sleep(50);
      await chrome.tabs.sendMessage(tabId, { type: 'BRAIN_CAPTURE_PAGE' });
      return true;
    } catch {
      return false;
    }
  }
}

async function captureTab(tab, { startVisitIfActive = true, transitionType = 'link' } = {}) {
  if (!tab?.id || !isTrackableUrl(safeUrl(tab.url))) return;
  const clean = safeUrl(tab.url);
  const current = await getIndex(PAGE_STORE, 'url', clean);
  if (current) {
    current.title = tab.title || current.title || clean;
    current.lastSeenAt = Math.max(current.lastSeenAt || 0, Date.now());
    await put(PAGE_STORE, current);
  } else {
    await put(PAGE_STORE, {
      id: uuid(), url: clean, title: tab.title || clean, description: '', headings: [],
      contentText: '', firstSeenAt: Date.now(), lastSeenAt: Date.now(), visitCount: 0
    });
  }
  if (startVisitIfActive && tab.active) {
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    if (activeTabs[0]?.id === tab.id) await startVisit(tab.id, clean, tab.title || '', tab.windowId, transitionType);
  }
  await capturePage(tab.id);
}

async function captureOpenTabs() {
  const tabs = await chrome.tabs.query({});
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const activeId = activeTabs[0]?.id;
  for (const tab of tabs) {
    if (!tab.id || !isTrackableUrl(safeUrl(tab.url))) continue;
    await captureTab(tab, { startVisitIfActive: tab.id === activeId, transitionType: 'reload' });
  }
}

async function importHistory() {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const items = await chrome.history.search({ text: '', startTime: since, maxResults: 1000 });
  let importedVisits = 0;

  for (const item of items) {
    const url = safeUrl(item.url);
    if (!isTrackableUrl(url)) continue;

    const visits = await chrome.history.getVisits({ url }).catch(() => []);
    const relevant = visits.filter(v => v.visitTime && v.visitTime >= since);
    const first = relevant.reduce((min, v) => Math.min(min, v.visitTime), Infinity);
    const last = relevant.reduce((max, v) => Math.max(max, v.visitTime), 0);
    const existing = await getIndex(PAGE_STORE, 'url', url);
    const page = {
      id: existing?.id || uuid(),
      url,
      title: item.title || existing?.title || url,
      description: existing?.description || '',
      headings: existing?.headings || [],
      contentText: existing?.contentText || '',
      firstSeenAt: existing?.firstSeenAt || (Number.isFinite(first) ? first : last || Date.now()),
      lastSeenAt: Math.max(existing?.lastSeenAt || 0, last || Date.now()),
      visitCount: Math.max(existing?.visitCount || 0, item.visitCount || relevant.length || 1),
      contentHash: existing?.contentHash
    };
    await put(PAGE_STORE, page);

    for (const visit of relevant) {
      const id = `history:${visit.id}`;
      const already = await get(VISIT_STORE, id);
      if (already) continue;
      await put(VISIT_STORE, {
        id,
        tabId: null,
        windowId: null,
        pageId: page.id,
        url,
        title: page.title,
        startedAt: visit.visitTime,
        endedAt: visit.visitTime,
        durationMs: 0,
        source: 'history',
        transitionType: visit.transition
      });
      importedVisits++;
    }
  }

  await chrome.storage.local.set({ brainHistoryImportedAt: Date.now(), brainHistoryImportedVisits: importedVisits });
  return { importedVisits, pages: items.length };
}

chrome.webNavigation.onCommitted.addListener(async d => {
  if (d.frameId !== 0) return;
  const url = safeUrl(d.url);
  await event('navigation', { tabId: d.tabId, windowId: d.windowId, url, transitionType: d.transitionType });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => lockTab(tabId, async () => {
  if (!tab?.url || !isTrackableUrl(safeUrl(tab.url))) return;
  const url = safeUrl(tab.url);

  if (changeInfo.url) {
    await event('tab_updated', { tabId, windowId: tab.windowId, url, title: tab.title || '' });
  }

  if (changeInfo.status === 'complete' || changeInfo.url) {
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    const isCurrent = activeTabs[0]?.id === tabId;
    await captureTab(tab, { startVisitIfActive: isCurrent, transitionType: changeInfo.url ? 'link' : 'reload' });
  } else if (changeInfo.title) {
    const page = await getIndex(PAGE_STORE, 'url', url);
    if (page) { page.title = changeInfo.title; page.lastSeenAt = Date.now(); await put(PAGE_STORE, page); }
  }
}));

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isTrackableUrl(safeUrl(tab.url))) return;
  await event('tab_activated', { tabId, windowId, url: safeUrl(tab.url), title: tab.title || '' });
  await endCurrentVisit();
  await captureTab(tab, { startVisitIfActive: true, transitionType: 'link' });
});

chrome.tabs.onRemoved.addListener(async (tabId, info) => {
  const active = await get(ACTIVE_STORE, tabId);
  if (active) await endVisit(tabId);
  const focus = await get(STATE_STORE, 'focus');
  if (focus?.tabId === tabId) await tx(STATE_STORE, 'readwrite', s => s.delete('focus'));
  await event('tab_removed', { tabId, windowId: info.windowId });
});

chrome.runtime.onStartup.addListener(async () => {
  await importHistory().catch(() => {});
  await captureOpenTabs().catch(() => {});
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await importHistory().catch(() => {});
  await captureOpenTabs().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PAGE_CAPTURE') {
    (async () => {
      const data = message.page || {};
      const url = safeUrl(data.url);
      if (!isTrackableUrl(url)) return { ok: false, error: 'Untrackable URL' };
      const existing = await getIndex(PAGE_STORE, 'url', url);
      const now = Date.now();
      await put(PAGE_STORE, {
        id: existing?.id || uuid(),
        url,
        title: data.title || existing?.title || url,
        description: data.description || existing?.description || '',
        headings: data.headings?.length ? data.headings : (existing?.headings || []),
        contentText: data.contentText || existing?.contentText || '',
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
        visitCount: existing?.visitCount || 0,
        contentHash: data.contentHash || existing?.contentHash
      });
      return { ok: true };
    })().then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message?.type === 'GET_RECENT_MEMORY') {
    Promise.all([
      count(EVENT_STORE), count(PAGE_STORE), count(VISIT_STORE),
      all(PAGE_STORE, 50), all(VISIT_STORE, 100), all(EVENT_STORE, 150),
      get(STATE_STORE, 'focus')
    ]).then(([eventsCount, pagesCount, visitsCount, pages, visits, events, focus]) => {
      sendResponse({ ok: true, eventsCount, pagesCount, visitsCount, pages, visits, events, focus });
    }).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message?.type === 'IMPORT_HISTORY') {
    importHistory().then(result => sendResponse({ ok: true, ...result })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
