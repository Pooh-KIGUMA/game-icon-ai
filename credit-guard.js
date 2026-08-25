(() => {
  // Credits are consumed server-side by /api/generate-gated.
  // This browser script only displays the current balance; it never wraps fetch,
  // so generation cannot be blocked by a client-side credit request on iOS.
  const nativeFetch = window.fetch.bind(window);
  let remaining = null;
  let plan = 'free';

  function badge() {
    if (document.getElementById('iconiaCredits')) return;
    const el = document.createElement('div');
    el.id = 'iconiaCredits';
    el.style.cssText = 'position:fixed;right:12px;top:78px;z-index:40;background:#151822;color:#f6f7fb;border:1px solid #34394b;border-radius:12px;padding:7px 10px;font:700 11px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 8px 28px #0008;pointer-events:none';
    document.body.appendChild(el);
  }

  function render() {
    badge();
    const el = document.getElementById('iconiaCredits');
    el.textContent = remaining == null ? 'クレジット確認中…' : `✦ ${remaining} クレジット`;
    el.title = plan;
  }

  async function refresh() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await nativeFetch('/api/credits', { credentials:'same-origin', signal:controller.signal, cache:'no-store' });
      clearTimeout(timer);
      if (!r.ok) { remaining = null; render(); return; }
      const data = await r.json();
      remaining = Number(data.credits ?? 0);
      plan = data.plan || 'free';
      render();
    } catch {
      remaining = null;
      render();
    }
  }

  window.iconiaCredits = { refresh, get: () => ({ credits: remaining, plan }) };
  badge();
  refresh();
})();
