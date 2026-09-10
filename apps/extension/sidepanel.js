const $ = (id) => document.querySelector(id);
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const time = ts => new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(ts));
const host = url => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return url || ''; } };
const duration = ms => { if (!ms) return 'active'; const s=Math.floor(ms/1000); return s<60?`${s}s`:`${Math.floor(s/60)}m ${s%60}s`; };
async function refresh(){
  const r=await chrome.runtime.sendMessage({type:'GET_RECENT_MEMORY'}).catch(()=>null); if(!r?.ok)return;
  $('#events').textContent=r.eventsCount.toLocaleString(); $('#pages').textContent=r.pagesCount.toLocaleString(); $('#visits').textContent=r.visitsCount.toLocaleString(); $('#updated').textContent=`Updated ${time(Date.now())}`;
  const pages=r.pages||[];
  $('#list').innerHTML=pages.length?pages.map(p=>`<article class="item"><div class="dot"></div><div class="item-main"><div class="item-title">${escapeHtml(p.title||host(p.url))}</div><a class="item-url" href="${escapeHtml(p.url)}" target="_blank">${escapeHtml(p.url)}</a><div class="item-meta">${time(p.lastSeenAt)} · ${p.visitCount||1} visit${(p.visitCount||1)===1?'':'s'}</div></div></article>`).join(''):'<div class="empty">No pages captured yet.</div>';
}
$('#refresh').addEventListener('click',refresh); refresh(); setInterval(refresh,2000);
