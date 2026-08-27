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

  async function refreshCredits() {
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
    }
  }

  refreshCredits();
  window.addEventListener('pageshow', refreshCredits);
  window.addEventListener('focus', refreshCredits);
})();
