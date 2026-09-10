const $ = (id) => document.querySelector(id);
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp));
}
function formatDuration(ms) {
  if (!ms || ms < 1000) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
function host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }

async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_RECENT_MEMORY' }).catch(() => null);
  if (!result?.ok) return;
  $('#events').textContent = result.events.length ? result.events.length.toLocaleString() : '0';
  $('#pages').textContent = result.pages.length ? result.pages.length.toLocaleString() : '0';
  $('#visits').textContent = result.visits.length ? result.visits.length.toLocaleString() : '0';
  $('#updated').textContent = `Updated ${formatTime(Date.now())}`;

  const visits = result.visits.slice(0, 30);
  $('#list').innerHTML = visits.length ? visits.map(visit => `
    <article class="item">
      <div class="dot"></div>
      <div class="item-main">
        <div class="item-title">${escapeHtml(visit.title || host(visit.url) || 'Untitled page')}</div>
        <div class="item-url">${escapeHtml(host(visit.url) || visit.url)}</div>
        <div class="item-meta">${formatTime(visit.startedAt)} · ${visit.durationMs ? formatDuration(visit.durationMs) : 'active visit'}</div>
      </div>
    </article>`).join('') : '<div class="empty">No visits captured yet. Browse a few pages and refresh.</div>';
}

$('#refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 3000);
