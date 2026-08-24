(() => {
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
  async function getSession() {
    try {
      if (window.supabase?.auth?.getSession) return (await window.supabase.auth.getSession()).data?.session || null;
    } catch {}
    try {
      const keys = Object.keys(localStorage).filter(k => k.includes('auth-token'));
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed?.access_token) return parsed;
      }
    } catch {}
    return null;
  }
  async function credit(action) {
    const session = await getSession();
    if (!session?.access_token) throw Object.assign(new Error('AUTHENTICATION_REQUIRED'), { code:'AUTHENTICATION_REQUIRED', status:401 });
    const r = await nativeFetch('/api/credits', {
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
      body:JSON.stringify({action})
    });
    const data = await r.json().catch(()=>({}));
    if (!r.ok) throw Object.assign(new Error(data.message || data.error || 'credits error'), {code:data.error,status:r.status});
    remaining = Number(data.credits ?? remaining);
    plan = data.plan || plan;
    render();
    return data;
  }
  async function refresh() {
    try {
      const session = await getSession();
      if (!session?.access_token) { remaining=null; render(); return; }
      const r = await nativeFetch('/api/credits',{headers:{Authorization:`Bearer ${session.access_token}`}});
      if (!r.ok) { remaining=null; render(); return; }
      const data=await r.json();
      remaining=Number(data.credits||0); plan=data.plan||'free'; render();
    } catch { remaining=null; render(); }
  }
  const originalFetch = window.fetch;
  window.fetch = async (input, init={}) => {
    const url=typeof input==='string'?input:input?.url||'';
    const isGenerate=/\/api\/generate(?:\?|$)/.test(url);
    if(!isGenerate || busy) return originalFetch(input,init);
    if(remaining===0){const err=new Error('NO_CREDITS');err.code='NO_CREDITS';throw err;}
    busy=true; let consumed=false;
    try{
      await credit('consume'); consumed=true;
      const session=await getSession();
      const headers=new Headers(init.headers || (typeof input!=='string'?input.headers:undefined));
      if(session?.access_token) headers.set('Authorization',`Bearer ${session.access_token}`);
      const response=await originalFetch(input,{...init,headers});
      if(!response.ok && consumed){try{await credit('refund')}catch{}}
      return response;
    }catch(error){
      if(consumed && error?.code!=='NO_CREDITS'){try{await credit('refund')}catch{}}
      throw error;
    }finally{busy=false;refresh();}
  };
  window.iconiaCredits={refresh,get:()=>({credits:remaining,plan})};
  badge(); refresh();
})();
