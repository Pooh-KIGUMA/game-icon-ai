(() => {
  // Keep the generation gate deliberately simple: Iconia currently uses a
  // signed first-party cookie for anonymous credits, so waiting on a client
  // auth-session object is unnecessary and can hang inside the iframe on iOS.
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

  function withTimeout(promise, ms = 15000) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('クレジットサービスへの接続がタイムアウトしました。'), { code: 'CREDITS_TIMEOUT' })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function credit(action) {
    const headers = {'Content-Type':'application/json'};
    const r = await withTimeout(nativeFetch('/api/credits', {
      method:'POST',
      headers,
      credentials:'same-origin',
      body:JSON.stringify({action})
    }));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.message || data.error || 'credits error'), {code:data.error,status:r.status});
    remaining = Number(data.credits ?? remaining);
    plan = data.plan || plan;
    render();
    return data;
  }

  async function refresh() {
    try {
      const r = await withTimeout(nativeFetch('/api/credits',{credentials:'same-origin'}), 10000);
      if (!r.ok) { remaining=null; render(); return; }
      const data=await r.json();
      remaining=Number(data.credits ?? 0); plan=data.plan||'free'; render();
    } catch { remaining=null; render(); }
  }

  const originalFetch = window.fetch;
  window.fetch = async (input, init={}) => {
    const url=typeof input==='string'?input:input?.url||'';
    const isGenerate=/\/api\/generate(?:\?|$)/.test(url);
    if(!isGenerate || busy) return originalFetch(input,init);

    if(remaining===0){
      const err=new Error('現在クレジットがありません。料金プランからクレジットを追加してください。');
      err.code='NO_CREDITS';
      throw err;
    }

    busy=true;
    let consumed=false;
    try{
      await credit('consume');
      consumed=true;
      const headers=new Headers(init.headers || (typeof input!=='string'?input.headers:undefined));
      const response=await originalFetch(input,{...init,headers,credentials:'same-origin'});

      if(!response.ok){
        if(consumed){try{await credit('refund')}catch{}}
        if(response.status===429){
          return new Response(JSON.stringify({
            success:false,
            error:'画像生成AIの利用上限に達しています。サイト側のクレジットとは別に、AI APIの残高が必要です。管理者がAPI残高を追加すると再び利用できます。',
            code:'AI_API_QUOTA_EXHAUSTED'
          }),{status:429,headers:{'Content-Type':'application/json'}});
        }
      }
      return response;
    }catch(error){
      if(consumed && error?.code!=='NO_CREDITS'){try{await credit('refund')}catch{}}
      throw error;
    }finally{
      busy=false;
      refresh();
    }
  };

  window.iconiaCredits={refresh,get:()=>({credits:remaining,plan})};
  badge();
  refresh();
})();
