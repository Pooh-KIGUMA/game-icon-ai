(() => {
  if (window.__iconiaMobileFixV12) return;
  window.__iconiaMobileFixV12 = true;
  const $ = id => document.getElementById(id);
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
    try{const b=await createImageBitmap(file),max=1600,s=Math.min(1,max/Math.max(b.width,b.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(b.width*s));c.height=Math.max(1,Math.round(b.height*s));c.getContext('2d').drawImage(b,0,0,c.width,c.height);b.close?.();const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.84));return blob?new File([blob],'iconia-reference.jpg',{type:'image/jpeg'}):file}catch{return file;}
  }
  function preview(file){const w=$('attach'),img=$('preview');if(!w||!img)return;img.src=URL.createObjectURL(file);w.classList.add('show');const l=$('attachLabel');if(l)l.textContent='この画像を元に編集します';}
  function bind(){
    const btn=$('attachBtn'),input=$('file');if(!btn||!input)return stabilize();
    btn.type='button';btn.style.display='inline-grid';
    if(!btn.__v12){btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();input.click();},true);btn.__v12=true;}
    if(!input.__v12){input.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;const out=await compress(f);preview(out);if(out!==f){try{const dt=new DataTransfer();dt.items.add(out);input.files=dt.files;}catch{}}const send=$('send');if(send)send.disabled=false;stabilize();},false);input.__v12=true;}
    const rem=$('remove');if(rem&&!rem.__v12){rem.addEventListener('click',()=>{$('attach')?.classList.remove('show');if(input)input.value='';const img=$('preview');if(img)img.removeAttribute('src');});rem.__v12=true;}
    stabilize();
  }
  function run(){requestAnimationFrame(bind)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
  [100,500,1500,3000].forEach(t=>setTimeout(run,t));addEventListener('resize',run,{passive:true});
})();
