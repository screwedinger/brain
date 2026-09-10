chrome.runtime.sendMessage({ type: 'GET_LOCAL_STATS' }).then((result) => {
  if (!result?.ok) return;
  document.querySelector('#events').textContent = result.events.toLocaleString();
  document.querySelector('#pages').textContent = result.pages.toLocaleString();
  document.querySelector('#visits').textContent = result.visits.toLocaleString();
}).catch(() => {});
