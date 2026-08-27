(() => {
  if (window.__iconiaMobileFixV7) return;
  window.__iconiaMobileFixV7 = true;
  const $ = id => document.getElementById(id);

  function stabilize() {
    const header = document.querySelector('.header');
    if (header && window.innerWidth <= 700) {
      header.style.setProperty('position','fixed','important');
      header.style.setProperty('top','0','important');
      header.style.setProperty('left','0','important');
      header.style.setProperty('right','0','important');
      header.style.setProperty('z-index','1100','important');
      document.body.style.paddingTop = '64px';
    }
    const composer = document.querySelector('.composerWrap');
    if (composer) {
      composer.style.setProperty('position','fixed','important');
      composer.style.setProperty('left','0','important');
      composer.style.setProperty('right','0','important');
      composer.style.setProperty('bottom','0','important');
      composer.style.setProperty('top','auto','important');
      composer.style.setProperty('z-index','1000','important');
    }
  }

  function bindUpload() {
    const button = $('attachBtn'), file = $('file');
    if (button && file) {
      button.type = 'button';
      button.style.display = 'inline-grid';
      button.onclick = e => {
        e.preventDefault();
        try { if (file.showPicker) file.showPicker(); else file.click(); }
        catch (_) { file.click(); }
      };
    }
    stabilize();
  }

  // Simple new-image generation uses the credit-aware fast endpoint first.
  // Complex edits still fall back to the original API inside generate-fast.js.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url === '/api/generate' && init?.method === 'POST' && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        const fastBody = { ...body };
        if (!fastBody.image) {
          return nativeFetch('/api/generate-fast', { ...init, body: JSON.stringify(fastBody) });
        }
      }
    } catch (_) {}
    return nativeFetch(input, init);
  };

  function run() { requestAnimationFrame(() => { bindUpload(); setTimeout(bindUpload,100); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, {once:true});
  else run();
  window.addEventListener('resize', run, {passive:true});
  window.addEventListener('orientationchange', () => setTimeout(run,150), {passive:true});
  [0,100,400,1000,2000].forEach(ms => setTimeout(run,ms));
})();
