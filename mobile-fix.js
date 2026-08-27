(() => {
  // iPhone/Safari stabilization + reliable image attachment.
  if (window.__iconiaMobileFixV4) return;
  window.__iconiaMobileFixV4 = true;

  const $ = id => document.getElementById(id);

  function stabilizeViewport() {
    const c = document.querySelector('.composerWrap');
    if (c) {
      c.id = c.id || 'composerWrap';
      c.style.setProperty('position', 'fixed', 'important');
      c.style.setProperty('left', '0', 'important');
      c.style.setProperty('right', '0', 'important');
      c.style.setProperty('top', 'auto', 'important');
      c.style.setProperty('bottom', '0', 'important');
      c.style.setProperty('z-index', '1000', 'important');
      c.style.setProperty('transform', 'none', 'important');
      c.style.setProperty('will-change', 'auto', 'important');
    }
    const h = document.querySelector('.header');
    if (h && window.innerWidth <= 700) {
      h.style.setProperty('position', 'fixed', 'important');
      h.style.setProperty('top', '0', 'important');
      h.style.setProperty('left', '0', 'important');
      h.style.setProperty('right', '0', 'important');
      h.style.setProperty('z-index', '1100', 'important');
    }
    document.body.style.paddingTop = window.innerWidth <= 700 ? '64px' : '';
  }

  function syncSend() {
    const input = $('text');
    const send = $('send');
    if (!input || !send) return;
    const pending = Boolean(window.__iconiaPendingImage);
    send.disabled = Boolean(window.__iconiaGenerating) || (!String(input.value || '').trim() && !pending);
  }

  function setAttachment(dataUrl, file) {
    window.__iconiaPendingImage = dataUrl;
    const attach = $('attach');
    const preview = $('preview');
    const label = $('attachLabel');
    if (preview) preview.src = dataUrl;
    if (label) label.textContent = `${file?.name || '画像'} を添付しました`;
    if (attach) attach.classList.add('show');
    syncSend();
    schedule();
  }

  function readImage(file) {
    if (!file || !String(file.type || '').startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        setAttachment(canvas.toDataURL('image/jpeg', 0.86), file);
      };
      img.onerror = () => setAttachment(src, file);
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function bindUpload() {
    const button = $('attachBtn');
    const file = $('file');
    if (!button || !file || button.dataset.iconiaUploadBound === '1') return;
    button.dataset.iconiaUploadBound = '1';
    button.style.display = 'inline-grid';
    button.type = 'button';
    button.addEventListener('click', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      file.value = '';
      file.click();
    }, true);
    file.addEventListener('change', e => {
      e.stopImmediatePropagation();
      readImage(file.files?.[0]);
    }, true);
    const remove = $('remove');
    if (remove) remove.addEventListener('click', e => {
      e.preventDefault();
      window.__iconiaPendingImage = null;
      if ($('preview')) $('preview').removeAttribute('src');
      if ($('attach')) $('attach').classList.remove('show');
      syncSend();
    }, true);
  }

  let raf = 0;
  function schedule() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      stabilizeViewport();
      bindUpload();
      syncSend();
    });
  }

  const input = $('text');
  if (input) {
    input.addEventListener('input', schedule, { passive: true });
    input.addEventListener('focus', schedule, { passive: true });
    input.addEventListener('blur', schedule, { passive: true });
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule, { passive: true });
    window.visualViewport.addEventListener('scroll', schedule, { passive: true });
  }
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(schedule, 150), { passive: true });
  document.addEventListener('click', e => {
    const target = e.target?.closest?.('#newBtn,#sideNew');
    if (target) setTimeout(schedule, 50);
  }, true);
  [0, 100, 400, 1000].forEach(ms => setTimeout(schedule, ms));
})();
