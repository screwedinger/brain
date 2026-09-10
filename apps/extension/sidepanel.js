const $ = id => document.querySelector(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const formatTime = ts => ts ? new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(ts)) : '—';
const formatDateTime = ts => ts ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(ts)) : '—';
const host = url => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return url || ''; } };
const duration = ms => { if (ms == null) return 'Currently active'; const s=Math.max(0,Math.floor(ms/1000)); return s<60?`${s}s`:`${Math.floor(s/60)}m ${s%60}s`; };
let activeTab = 'visits';
let latest = { pages: [], visits: [], events: [], focus: null };
let refreshing = false;

function setStatus(message = '', kind = '') {
  const el = $('#status');
  el.textContent = message;
  el.className = `status ${kind}`;
}

function render() {
  const list = $('#list');
  if (activeTab === 'visits') {
    list.innerHTML = latest.visits.length ? latest.visits.map(v => {
      const active = !v.endedAt && latest.focus?.tabId === v.tabId;
      return `<article class="item ${active ? 'active-item' : ''}"><div class="dot"></div><div class="item-main"><div class="item-title">${escapeHtml(v.title || host(v.url))}</div><a class="item-url" href="${escapeHtml(v.url || '#')}" target="_blank">${escapeHtml(v.url || '')}</a><div class="item-meta">Started ${formatDateTime(v.startedAt)} · ${active ? 'Currently active' : `Duration ${duration(v.durationMs)}`} · Tab ${v.tabId == null ? 'history' : escapeHtml(v.tabId)}</div></div></article>`;
    }).join('') : '<div class="empty">No visits captured yet.</div>';
  } else if (activeTab === 'pages') {
    list.innerHTML = latest.pages.length ? latest.pages.map(p => `<article class="item"><div class="dot"></div><div class="item-main"><div class="item-title">${escapeHtml(p.title || host(p.url))}</div><a class="item-url" href="${escapeHtml(p.url || '#')}" target="_blank">${escapeHtml(p.url || '')}</a><div class="item-meta">First seen ${formatDateTime(p.firstSeenAt)} · Last seen ${formatDateTime(p.lastSeenAt)} · ${p.visitCount || 0} visit${(p.visitCount||0)===1?'':'s'}${p.contentText ? ' · Content captured' : ''}</div></div></article>`).join('') : '<div class="empty">No pages captured yet.</div>';
  } else {
    list.innerHTML = latest.events.length ? latest.events.map(e => `<article class="item"><div class="dot"></div><div class="item-main"><div class="item-title">${escapeHtml(e.type.replaceAll('_',' '))}</div>${e.url ? `<a class="item-url" href="${escapeHtml(e.url)}" target="_blank">${escapeHtml(e.url)}</a>` : ''}<div class="item-meta">${formatDateTime(e.timestamp)} · Tab ${e.tabId == null ? '—' : escapeHtml(e.tabId)}${e.transitionType ? ` · ${escapeHtml(e.transitionType)}` : ''}</div></div></article>`).join('') : '<div class="empty">No browser events captured yet.</div>';
  }
}

async function refresh({silent = false} = {}) {
  if (refreshing) return;
  refreshing = true;
  if (!silent) setStatus('Refreshing…');
  try {
    const r = await chrome.runtime.sendMessage({type:'GET_RECENT_MEMORY'});
    if (!r?.ok) throw new Error(r?.error || 'Brain could not read local memory');
    $('#events').textContent = Number(r.eventsCount || 0).toLocaleString();
    $('#pages').textContent = Number(r.pagesCount || 0).toLocaleString();
    $('#visits').textContent = Number(r.visitsCount || 0).toLocaleString();
    $('#updated').textContent = `Updated ${formatTime(Date.now())}`;
    latest = { pages:r.pages || [], visits:r.visits || [], events:r.events || [], focus:r.focus || null };
    render();
    if (!silent) setStatus('Up to date', 'success');
  } catch (error) {
    setStatus(error.message || 'Refresh failed', 'error');
  } finally {
    refreshing = false;
  }
}

async function importHistory() {
  const button = $('#import');
  button.disabled = true;
  setStatus('Importing the last 30 days of Chrome history…');
  try {
    const r = await chrome.runtime.sendMessage({type:'IMPORT_HISTORY'});
    if (!r?.ok) throw new Error(r?.error || 'History import failed');
    setStatus(`Imported ${Number(r.importedVisits || 0).toLocaleString()} historical visits.`, 'success');
    await refresh({silent:true});
  } catch (error) {
    setStatus(error.message || 'History import failed', 'error');
  } finally {
    button.disabled = false;
  }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  button.classList.add('active');
  activeTab = button.dataset.tab;
  render();
}));
$('#refresh').addEventListener('click', () => refresh());
$('#import').addEventListener('click', importHistory);
refresh();
setInterval(() => refresh({silent:true}), 1500);
