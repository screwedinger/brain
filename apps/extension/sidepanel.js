const $ = (id) => document.querySelector(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const formatTime = ts => new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(ts));
const formatDateTime = ts => new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(ts));
const host = url => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return url || ''; } };
const duration = ms => { if (ms == null) return 'active'; const s=Math.floor(ms/1000); return s<60?`${s}s`:`${Math.floor(s/60)}m ${s%60}s`; };
let activeTab = 'visits';
let latest = { pages: [], visits: [], events: [] };

function render() {
  const list = $('#list');
  if (activeTab === 'visits') {
    list.innerHTML = latest.visits.length ? latest.visits.map(v => `<article class="item"><div class="dot"></div><div class="item-main"><div class="item-title">${escapeHtml(v.title || host(v.url))}</div><a class="item-url" href="${escapeHtml(v.url || '#')}" target="_blank">${escapeHtml(v.url || '')}</a><div class="item-meta">Started ${formatDateTime(v.startedAt)} · ${v.endedAt ? `Duration ${duration(v.durationMs)}` : 'Currently active'} · Tab ${escapeHtml(v.tabId)}</div></div></article>`).join('') : '<div class="empty">No visits captured yet.</div>';
  } else if (activeTab === 'pages') {
    list.innerHTML = latest.pages.length ? latest.pages.map(p => `<article class="item"><div class="dot"></div><div class="item-main"><div class="item-title">${escapeHtml(p.title || host(p.url))}</div><a class="item-url" href="${escapeHtml(p.url || '#')}" target="_blank">${escapeHtml(p.url || '')}</a><div class="item-meta">First seen ${formatDateTime(p.firstSeenAt)} · Last seen ${formatDateTime(p.lastSeenAt)} · ${p.visitCount || 1} visit${(p.visitCount||1)===1?'':'s'}</div></div></article>`).join('') : '<div class="empty">No pages captured yet.</div>';
  } else {
    list.innerHTML = latest.events.length ? latest.events.map(e => `<article class="item"><div class="dot"></div><div class="item-main"><div class="item-title">${escapeHtml(e.type.replaceAll('_',' '))}</div><div class="item-url">${escapeHtml(e.url || '')}</div><div class="item-meta">${formatDateTime(e.timestamp)} · Tab ${e.tabId == null ? '—' : escapeHtml(e.tabId)}${e.transitionType ? ` · ${escapeHtml(e.transitionType)}` : ''}</div></div></article>`).join('') : '<div class="empty">No browser events captured yet.</div>';
  }
}

async function refresh(){
  const r=await chrome.runtime.sendMessage({type:'GET_RECENT_MEMORY'}).catch(()=>null); if(!r?.ok)return;
  $('#events').textContent=r.eventsCount.toLocaleString();
  $('#pages').textContent=r.pagesCount.toLocaleString();
  $('#visits').textContent=r.visitsCount.toLocaleString();
  $('#updated').textContent=`Updated ${formatTime(Date.now())}`;
  latest = { pages: r.pages || [], visits: r.visits || [], events: r.events || [] };
  render();
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  button.classList.add('active');
  activeTab = button.dataset.tab;
  render();
}));
$('#refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 2000);
