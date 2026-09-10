(() => {
  if (window.__BRAIN_CONTENT__) return;
  window.__BRAIN_CONTENT__ = true;

  const clean = (value) => value.replace(/\s+/g, ' ').trim();

  function extractPage() {
    const article = document.querySelector('article, main, [role="main"]') || document.body;
    const text = clean(article?.innerText || '').slice(0, 100_000);
    const headings = [...document.querySelectorAll('h1,h2,h3')]
      .map((node) => clean(node.textContent || ''))
      .filter(Boolean)
      .slice(0, 50);

    return {
      url: location.href,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      headings,
      contentText: text
    };
  }

  chrome.runtime.sendMessage({ type: 'PAGE_CAPTURE', page: extractPage() }).catch(() => {});
})();
