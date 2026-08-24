(() => {
  const KEY = 'iconia_credit_user_v1';
  const getId = () => {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(KEY, id);
    }
    return id;
  };

  const nativeFetch = window.fetch.bind(window);
  let remaining = null;
  let plan = 'free';
  let busy = false;

  function badge() {
    if (document.getElementById('iconiaCredits')) return;
    const el = document.createElement('div');
    el.id = 'iconiaCredits';
    el.style.cssText = 'position:fixed;right:12px;top:62px;z-index:9998;background:#151822;color:#f6f7fb;border:1px solid #34394b;border-radius:12px;padding:7px 10px;font:700 11px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 8px 28px #0008;pointer-events:none';
    document.body.appendChild(el);
  }
  function render() {
    badge();
    const el = document.getElementById('iconiaCredits');
    el.textContent = remaining == null ? 'クレジット確認中…' : `✦ ${remaining} クレジット`;
    el.title = plan;
  }

  async function credit(action) {
    const r = await nativeFetch('/api/credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Iconia-User-Id': getId() },
      body: JSON.stringify({ action })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.message || data.error || 'credits error'), { code: data.error, status: r.status });
    remaining = data.credits;
    plan = data.plan || plan;
    render();
    return data;
  }

  async function refresh() {
    try {
      const r = await nativeFetch('/api/credits', { headers: { 'X-Iconia-User-Id': getId() } });
      if (!r.ok) return;
      const data = await r.json();
      remaining = data.credits;
      plan = data.plan || 'free';
      render();
    } catch {}
  }

  const originalFetch = window.fetch;
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isGenerate = /\/api\/generate(?:\?|$)/.test(url);
    if (!isGenerate || busy) return originalFetch(input, init);

    if (remaining === 0) {
      const err = new Error('NO_CREDITS');
      err.code = 'NO_CREDITS';
      throw err;
    }

    busy = true;
    let consumed = false;
    try {
      await credit('consume');
      consumed = true;
      const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
      headers.set('X-Iconia-User-Id', getId());
      const next = { ...init, headers };
      const response = await originalFetch(input, next);
      if (!response.ok && consumed) {
        try { await credit('refund'); } catch {}
      }
      return response;
    } catch (error) {
      if (consumed && error?.code !== 'NO_CREDITS') {
        try { await credit('refund'); } catch {}
      }
      throw error;
    } finally {
      busy = false;
      refresh();
    }
  };

  window.iconiaCredits = { refresh, get: () => ({ credits: remaining, plan }) };
  badge();
  refresh();
})();
