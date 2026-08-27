export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  try {
    const host = req.headers.host;
    if (!host) throw new Error('HOST_MISSING');
    const r = await fetch(`https://${host}/index.html?iconia_balance=1`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`INDEX_FETCH_${r.status}`);
    let html = await r.text();
    html = html.replace('<div class="composerWrap">', '<div class="composerWrap" id="composerWrap">');
    html = html.replace("function syncViewport(){const vv=window.visualViewport;if(!vv)return;const keyboard=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);const composer=$('composerWrap');composer.style.bottom='0px';composer.style.transform=keyboard>80?'translate3d(0,'+(-keyboard)+'px,0)':'translate3d(0,0,0)';document.documentElement.style.setProperty('--vvh',vv.height+'px')}","function syncViewport(){const vv=window.visualViewport;const composer=$('composerWrap');if(!composer)return;if(!vv){composer.style.bottom='0px';composer.style.transform='translate3d(0,0,0)';return}const keyboard=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);composer.style.bottom='0px';composer.style.transform=keyboard>80?'translate3d(0,'+(-keyboard)+'px,0)':'translate3d(0,0,0)';document.documentElement.style.setProperty('--vvh',vv.height+'px')}");
    const script = '<script src="/credit-balance.js?v=2" defer></script>';
    const runtime = `<script>(()=>{const fix=()=>{const c=document.querySelector('.composerWrap');if(c){c.id='composerWrap';c.style.setProperty('position','fixed','important');c.style.setProperty('left','0','important');c.style.setProperty('right','0','important');c.style.setProperty('bottom','0','important');c.style.setProperty('top','auto','important');c.style.setProperty('z-index','1000','important')}const b=document.getElementById('attachBtn'),f=document.getElementById('file');if(b&&f&&!b.dataset.iconiaBound){b.dataset.iconiaBound='1';b.type='button';b.addEventListener('click',e=>{e.preventDefault();try{f.showPicker?f.showPicker():f.click()}catch(_){f.click()}})}};fix();setTimeout(fix,100);setTimeout(fix,500);setTimeout(fix,1500)})();</script>`;
    if (!html.includes('/credit-balance.js')) html = html.replace('</body>', `${script}${runtime}</body>`);
    else html = html.replace('</body>', `${runtime}</body>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.status(200).send(html);
  } catch (e) {
    console.error('Iconia app shell error', e);
    return res.status(503).send('Iconia AI を読み込めませんでした。');
  }
}
