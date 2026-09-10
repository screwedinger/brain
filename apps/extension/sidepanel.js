chrome.runtime.sendMessage({ type: 'GET_LOCAL_STATS' }).then((result) => {
  if (result?.ok) document.querySelector('#events').textContent = result.events.toLocaleString();
});
