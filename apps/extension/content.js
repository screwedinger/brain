(() => {
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

  // A service-worker restart or extension reload can leave the content script
  // alive in an existing tab. Install the request listener exactly once.
  if (!window.__BRAIN_CAPTURE_LISTENER__) {
    window.__BRAIN_CAPTURE_LISTENER__ = true;
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === 'BRAIN_CAPTURE_PAGE') capture();
    });
  }

  // Capture once when the script is first injected on a document.
  if (!window.__BRAIN_CONTENT__) {
    window.__BRAIN_CONTENT__ = true;
    capture();
  }
})();
