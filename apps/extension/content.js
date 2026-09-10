(() => {
  if (window.__BRAIN_CONTENT__) {
    // The script may already be present after a navigation/reload. Keep the
    // listener alive so the background service worker can request a fresh capture.
    return;
  }
  window.__BRAIN_CONTENT__ = true;

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

  async function hashText(text) {
    try {
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return undefined;
    }
  }

  async function extractPage() {
    const article = document.querySelector('article, main, [role="main"]') || document.body;
    const text = clean(article?.innerText || '').slice(0, 100_000);
    const headings = [...document.querySelectorAll('h1,h2,h3')]
      .map(node => clean(node.textContent || ''))
      .filter(Boolean)
      .slice(0, 50);

    return {
      url: location.href,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      headings,
      contentText: text,
      contentHash: await hashText(text)
    };
  }

  async function capture() {
    const page = await extractPage();
    chrome.runtime.sendMessage({ type: 'PAGE_CAPTURE', page }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'BRAIN_CAPTURE_PAGE') capture();
  });

  capture();
})();
