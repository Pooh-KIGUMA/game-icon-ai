(() => {
  const style = document.createElement('style');
  style.textContent = `.creditBalance{display:flex;align-items:center;gap:7px;margin-left:6px;padding:9px 12px;border:1px solid #34394b;border-radius:14px;background:#151822;color:#f6f7fb;font-size:12px;font-weight:800;white-space:nowrap}.creditBalance b{color:#69e8c4;font-size:15px}.creditBalance.loading b{color:#8e96aa}@media(max-width:700px){.creditBalance{padding:8px 9px;font-size:10px;gap:4px}.creditBalance b{font-size:13px}.actions{gap:5px}.actions .creditBalance{order:-1}}
/* Iconia mobile layout: keep navigation and composer stable while the chat scrolls. */
.header{position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:80!important}.layout{padding-top:74px}.main{padding-bottom:300px!important}.composerWrap{z-index:70!important;bottom:0!important;top:auto!important;max-height:min(42vh,390px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.composer{max-height:none}.bar{overscroll-behavior-x:contain}.input{position:sticky;bottom:0;background:#151821;z-index:2;border-top:1px solid #242a38}.hint{padding-bottom:8px}
@media(max-width:700px){.layout{padding-top:64px}.main{padding-bottom:270px!important}.header{height:64px!important}.composerWrap{left:8px!important;right:8px!important;padding:6px 0 calc(env(safe-area-inset-bottom) + 6px)!important;max-height:34vh!important;border-radius:24px}.composer{border-radius:20px}.label{padding:5px 10px 0;font-size:8px}.bar{padding:4px 2px 2px;gap:5px}.chip{padding:7px 9px;font-size:9px}.attach{padding:7px 10px;gap:8px}.attach img{width:46px;height:46px;border-radius:8px}.attachInfo b{font-size:11px}.attachInfo small{font-size:9px}.remove{width:30px;height:30px;font-size:18px}.input{padding:7px;gap:6px}.iconBtn,.send{width:44px;height:44px;border-radius:13px}.text{min-height:44px;max-height:110px;padding:10px 2px}.hint{font-size:8px;padding:0 8px 6px}.actions{max-width:62vw;overflow:hidden}.headBtn{padding:7px 8px;font-size:10px;border-radius:12px}.brand{gap:7px}.brand .logo{width:42px;height:42px;border-radius:13px}.brand span{font-size:9px}.brand b{font-size:16px}.side{top:64px!important}}
@media(max-width:390px){.brand span{display:none}.actions{max-width:68vw}.headBtn{padding:7px 7px;font-size:9px}.creditBalance{padding:7px 7px!important}.composerWrap{max-height:36vh!important}.main{padding-bottom:255px!important}}
`;
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

  window.IconiaRefreshCredits = refreshCredits;

  refreshCredits();
  window.addEventListener('pageshow', refreshCredits);
  window.addEventListener('focus', refreshCredits);

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
