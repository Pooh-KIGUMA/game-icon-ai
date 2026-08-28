(() => {
  const style = document.createElement('style');
  style.textContent = `.creditBalance{display:flex;align-items:center;gap:7px;margin-left:6px;padding:9px 12px;border:1px solid #34394b;border-radius:14px;background:#151822;color:#f6f7fb;font-size:12px;font-weight:800;white-space:nowrap}.creditBalance b{color:#69e8c4;font-size:15px}.creditBalance.loading b{color:#8e96aa}@media(max-width:700px){.creditBalance{padding:8px 9px;font-size:10px;gap:4px}.creditBalance b{font-size:13px}.actions{gap:5px}.actions .creditBalance{order:-1}}`;
  document.head.appendChild(style);

  const actions = document.querySelector('.actions');
  if (!actions) return;

  const el = document.createElement('div');
  el.className = 'creditBalance loading';
  el.innerHTML = '🪙 残高 <b>—</b>';
  actions.insertBefore(el, actions.firstChild);

  let refreshInFlight = null;
  async function refreshCredits() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const r = await fetch('/api/credits', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        });
        const data = await r.json();
        if (!r.ok) throw new Error('credits');
        el.classList.remove('loading');
        el.innerHTML = `🪙 残高 <b>${Number(data.credits ?? 0)}</b>`;
        el.title = `現在 ${Number(data.credits ?? 0)} クレジット`;
      } catch {
        el.classList.remove('loading');
        el.innerHTML = '🪙 残高 <b>—</b>';
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  // Expose a small hook so the generation UI can request an immediate refresh.
  window.IconiaRefreshCredits = refreshCredits;

  refreshCredits();
  window.addEventListener('pageshow', refreshCredits);
  window.addEventListener('focus', refreshCredits);

  // Also watch fetch responses so the balance updates immediately after a
  // successful image generation, without requiring a page reload or navigation.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url || '';
      if (/\/api\/generate(?:[/?]|$)/.test(url)) {
        let ok = response.ok;
        if (response.status >= 400) ok = false;
        if (ok) setTimeout(refreshCredits, 0);
      }
    } catch {}
    return response;
  };
})();
