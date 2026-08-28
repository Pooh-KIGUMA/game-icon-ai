(() => {
  if (window.__iconiaMobileFixV17) return;
  window.__iconiaMobileFixV17 = true;
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

        // Keep the user's visible message untouched, but give Iconia's planner
        // an explicit art-direction brief. This prevents logo/text requests from
        // degenerating into "just paste the text in the middle". The planner can
        // inspect the reference image and choose the best visual hierarchy,
        // negative space, placement, scale and typography for that specific image.
        const targetUrl = typeof input === 'string' ? input : input?.url;
        if (targetUrl && targetUrl.includes('/api/generate-fast') && init?.body && typeof init.body === 'string') {
          try {
            const payload = JSON.parse(init.body);
            if (payload && typeof payload.message === 'string') {
              payload.message += `\n\n[ICONIA INTERNAL ART-DIRECTION — DO NOT SHOW USER]\nIf this request adds or designs text/logo, do not treat it as a simple text overlay. First visually analyze the reference or planned composition. Decide the most attractive placement from the actual image: use intentional negative space, visual balance, subject hierarchy, readability and safe margins; avoid covering a face or important focal detail unless explicitly requested. Choose typography that belongs to the image's genre and lighting, including appropriate weight, shape, depth, outline, shadow, glow, metallic/material treatment, perspective or emblem integration when useful. Vary placement and typography between different images when the composition calls for it. Do not default to centered text, generic white text, or a fixed bottom position. The logo should feel designed into the artwork, not pasted on top. If the user did not specify position, the AI must choose one deliberately and explain that choice internally through the plan. Preserve exact spelling. If an existing logo/text is being moved, move it rather than duplicating it.`;
              init = { ...init, body: JSON.stringify(payload) };
            }
          } catch {}
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

  function addLegalFooter(){
    if(document.getElementById('iconiaLegalFooter'))return;
    const footer=document.createElement('footer');
    footer.id='iconiaLegalFooter';
    footer.innerHTML=`<div class="iconiaLegalInner"><div class="iconiaLegalBrand">✦ <b>Iconia AI</b></div><div class="iconiaLegalLinks"><a href="/terms.html">利用規約</a><span>・</span><a href="/privacy.html">プライバシーポリシー</a></div><div class="iconiaLegalCopy">© 2026 Iconia AI</div></div>`;
    document.body.appendChild(footer);
  }

  function addLegalStyles(){
    if(document.getElementById('iconia-legal-style'))return;
    const s=document.createElement('style');s.id='iconia-legal-style';s.textContent=`
      #iconiaLegalFooter{margin:0 auto;padding:18px 14px 285px;text-align:center;color:#737b8e;font-size:10px}
      .iconiaLegalInner{max-width:980px;margin:auto;border-top:1px solid #242938;padding-top:16px}
      .iconiaLegalBrand{color:#cfd3df;margin-bottom:7px}
      .iconiaLegalLinks{display:flex;justify-content:center;align-items:center;gap:6px;flex-wrap:wrap}
      .iconiaLegalLinks a{color:#a99bff;text-decoration:none}
      .iconiaLegalLinks a:hover{text-decoration:underline}
      .iconiaLegalCopy{margin-top:7px;color:#555d70}
      @media(max-width:700px){#iconiaLegalFooter{padding-bottom:300px}}
    `;document.head.appendChild(s);
  }

  function loadHistoryEnhancements(){
    if(window.__iconiaHistoryEnhancementsLoaded)return;
    window.__iconiaHistoryEnhancementsLoaded=true;
    const s=document.createElement('script');s.src='/history-enhancements.js';s.async=false;document.body.appendChild(s);
  }

  function run(){
    requestAnimationFrame(()=>{recoverInterruptedGeneration();bind();addStyles();addSaveButtons();addLegalStyles();addLegalFooter();loadHistoryEnhancements();});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
  [100,500,1500,3000].forEach(t=>setTimeout(run,t));
  addEventListener('resize',run,{passive:true});
  new MutationObserver(()=>{addSaveButtons();stabilize()}).observe(document.body,{childList:true,subtree:true});
})();
