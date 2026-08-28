(() => {
  if (window.__iconiaMobileFixV15) return;
  window.__iconiaMobileFixV15 = true;
  const $ = id => document.getElementById(id);

  // Use the dedicated generation endpoint. The normal /api/generate route can
  // take too long on mobile and Safari may surface the aborted request as
  // "Load failed" after a refresh. The fast endpoint has the credit/refund
  // guard and a longer server-side timeout.
  try {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      try {
        const url = typeof input === 'string' ? input : input?.url;
        if (url && url.startsWith('/api/generate') && !url.includes('/api/generate-fast')) {
          const target = url.replace('/api/generate', '/api/generate-fast');
          if (typeof input === 'string') input = target;
          else input = new Request(target, input);
        }
      } catch {}
      return nativeFetch(input, init);
    };
  } catch {}

  function recoverInterruptedGeneration(){
    // A page reload cannot keep the in-flight fetch alive. The old UI was
    // saving its {loading:true} message to localStorage, so a reload restored
    // the spinner forever. Only clean it on an actual browser reload; never
    // interfere with a generation that is currently running in a fresh page.
    try{
      const nav=performance.getEntriesByType?.('navigation')?.[0];
      if(nav?.type!=='reload') return;
      const key='iconia_pro_v6';
      const raw=localStorage.getItem(key); if(!raw)return;
      const data=JSON.parse(raw); if(!Array.isArray(data?.messages))return;
      const hadLoading=data.messages.some(m=>m&&m.loading);
      if(!hadLoading)return;
      data.messages=data.messages.filter(m=>!m?.loading);
      localStorage.setItem(key,JSON.stringify(data));
      sessionStorage.setItem('iconia_recovered_reload','1');
      // The main app has already rendered from the stale snapshot. Reload once
      // after cleaning it so the normal load() path starts from the repaired data.
      if(!sessionStorage.getItem('iconia_recovered_reload_done')){
        sessionStorage.setItem('iconia_recovered_reload_done','1');
        location.reload();
      }
    }catch{}
  }

  function stabilize(){
    const h=document.querySelector('.header');
    if(h&&innerWidth<=700){
      h.style.setProperty('position','fixed','important');
      h.style.setProperty('top','0','important');
      h.style.setProperty('left','0','important');
      h.style.setProperty('right','0','important');
      h.style.setProperty('z-index','1100','important');
      h.style.setProperty('height','64px','important');
      document.body.style.paddingTop='64px';
    }
    const c=document.querySelector('.composerWrap');
    if(c){
      c.style.setProperty('position','fixed','important');
      c.style.setProperty('left','0','important');
      c.style.setProperty('right','0','important');
      c.style.setProperty('bottom','0','important');
      c.style.setProperty('top','auto','important');
      c.style.setProperty('z-index','1000','important');
      if(innerWidth<=700){
        c.style.setProperty('max-height','255px','important');
        c.style.setProperty('overflow-y','auto','important');
        c.style.setProperty('overflow-x','hidden','important');
        c.style.setProperty('padding-top','4px','important');
        c.style.setProperty('padding-bottom','calc(env(safe-area-inset-bottom) + 5px)','important');
      }
    }
  }

  async function compress(file){
    if(!file||!file.type?.startsWith('image/'))return file;
    try{
      const b=await createImageBitmap(file),max=1600,s=Math.min(1,max/Math.max(b.width,b.height));
      const c=document.createElement('canvas');c.width=Math.max(1,Math.round(b.width*s));c.height=Math.max(1,Math.round(b.height*s));
      c.getContext('2d').drawImage(b,0,0,c.width,c.height);b.close?.();
      const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.84));
      return blob?new File([blob],'iconia-reference.jpg',{type:'image/jpeg'}):file;
    }catch{return file;}
  }

  function preview(file){
    const w=$('attach'),img=$('preview');if(!w||!img)return;
    if(typeof file==='string') img.src=file; else img.src=URL.createObjectURL(file);
    w.classList.add('show');
    const l=$('attachLabel');if(l)l.textContent='この画像を元に編集します';
  }

  function bind(){
    const btn=$('attachBtn'),input=$('file');
    if(btn&&input){
      btn.type='button';btn.style.display='inline-grid';
      if(!btn.__v14){
        btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();input.click();},true);
        btn.__v14=true;
      }
      if(!input.__v14){
        input.addEventListener('change',async e=>{
          const f=e.target.files?.[0];if(!f)return;
          const out=await compress(f);preview(out);
          if(out!==f){try{const dt=new DataTransfer();dt.items.add(out);input.files=dt.files;}catch{}}
          const send=$('send');if(send)send.disabled=false;
          stabilize();
        },false);
        input.__v14=true;
      }
      const rem=$('remove');
      if(rem&&!rem.__v14){
        rem.addEventListener('click',()=>{$('attach')?.classList.remove('show');if(input)input.value='';const img=$('preview');if(img)img.removeAttribute('src');});
        rem.__v14=true;
      }
    }
    stabilize();
  }

  async function saveImage(src){
    try{
      let blob;
      if(src.startsWith('data:')){
        const r=await fetch(src);blob=await r.blob();
      }else{
        const r=await fetch(src,{mode:'cors'});if(!r.ok)throw new Error('image');blob=await r.blob();
      }
      const ext=(blob.type||'image/png').split('/')[1]?.replace('jpeg','jpg')||'png';
      const file=new File([blob],`iconia-ai-${Date.now()}.${ext}`,{type:blob.type||'image/png'});
      if(navigator.canShare?.({files:[file]}) && navigator.share){
        await navigator.share({title:'Iconia AI',text:'Iconia AIで作成した画像',files:[file]});
        return;
      }
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    }catch(e){
      try{window.open(src,'_blank','noopener');}catch{}
    }
  }

  function addSaveButtons(){
    document.querySelectorAll('.result').forEach(img=>{
      if(img.dataset.saveBound)return;
      img.dataset.saveBound='1';
      const wrap=img.parentElement;if(!wrap)return;
      const tools=document.createElement('div');
      tools.className='iconiaImageTools';
      tools.innerHTML='<button type="button" class="iconiaImageTool save">⬇️ 保存 / 共有</button><button type="button" class="iconiaImageTool zoom">🔍 拡大</button>';
      img.insertAdjacentElement('afterend',tools);
      tools.querySelector('.save').onclick=e=>{e.preventDefault();e.stopPropagation();saveImage(img.dataset.image||img.currentSrc||img.src)};
      tools.querySelector('.zoom').onclick=e=>{e.preventDefault();e.stopPropagation();if(typeof window.openLight==='function')window.openLight(img.dataset.image||img.currentSrc||img.src);else{const lb=$('lightbox'),li=$('lightImg');if(lb&&li){li.src=img.dataset.image||img.currentSrc||img.src;lb.classList.add('show')}}};
    });
  }

  function addStyles(){
    if(document.getElementById('iconia-v14-style'))return;
    const s=document.createElement('style');s.id='iconia-v14-style';s.textContent=`
      .iconiaImageTools{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      .iconiaImageTool{border:1px solid #34394b;background:#242938;color:#f6f7fb;border-radius:12px;padding:9px 12px;font-size:11px;font-weight:750}
      .iconiaImageTool:active{transform:scale(.97);opacity:.85}
      @media(max-width:700px){.iconiaImageTools{gap:6px}.iconiaImageTool{padding:9px 11px;font-size:10px}}
    `;document.head.appendChild(s);
  }

  function loadHistoryEnhancements(){
    if(window.__iconiaHistoryEnhancementsLoaded)return;
    window.__iconiaHistoryEnhancementsLoaded=true;
    const s=document.createElement('script');s.src='/history-enhancements.js';s.async=false;document.body.appendChild(s);
  }

  function run(){
    requestAnimationFrame(()=>{recoverInterruptedGeneration();bind();addStyles();addSaveButtons();loadHistoryEnhancements();});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
  [100,500,1500,3000].forEach(t=>setTimeout(run,t));
  addEventListener('resize',run,{passive:true});
  new MutationObserver(()=>{addSaveButtons();stabilize()}).observe(document.body,{childList:true,subtree:true});
})();
