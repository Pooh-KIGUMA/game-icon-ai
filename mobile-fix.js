(() => {
  if (window.__iconiaMobileFixV5) return;
  window.__iconiaMobileFixV5 = true;

  const $ = id => document.getElementById(id);

  function stabilize() {
    const header = document.querySelector('.header');
    if (header && window.innerWidth <= 700) {
      Object.assign(header.style, {position:'fixed', top:'0', left:'0', right:'0', zIndex:'1100'});
      document.body.style.paddingTop = '64px';
    }
    const composer = document.querySelector('.composerWrap');
    if (composer) {
      Object.assign(composer.style, {position:'fixed', left:'0', right:'0', bottom:'0', top:'auto', zIndex:'1000', transform:'none'});
    }
  }

  function syncSend() {
    const input = $('text'), send = $('send');
    if (!input || !send) return;
    const hasText = !!String(input.value || '').trim();
    const hasImage = !!window.__iconiaPendingImage;
    send.disabled = !!window.__iconiaGenerating || (!hasText && !hasImage);
  }

  function attachImage(file) {
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
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const data = canvas.toDataURL('image/jpeg', 0.86);
        window.__iconiaPendingImage = data;
        const preview = $('preview');
        const attach = $('attach');
        const label = $('attachLabel');
        if (preview) preview.src = data;
        if (label) label.textContent = `${file.name || '画像'} を添付しました`;
        if (attach) attach.classList.add('show');
        syncSend();
        stabilize();
      };
      img.onerror = () => {
        window.__iconiaPendingImage = src;
        if ($('preview')) $('preview').src = src;
        if ($('attach')) $('attach').classList.add('show');
        syncSend();
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function bind() {
    const button = $('attachBtn'), file = $('file');
    if (button && file && button.dataset.iconiaUploadBound !== '1') {
      button.dataset.iconiaUploadBound = '1';
      button.type = 'button';
      button.style.display = 'inline-grid';
      button.addEventListener('click', e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        file.value = '';
        if (file.showPicker) { try { file.showPicker(); return; } catch (_) {} }
        file.click();
      }, true);
      file.addEventListener('change', e => {
        e.stopImmediatePropagation();
        attachImage(file.files && file.files[0]);
      }, true);
    }
    const remove = $('remove');
    if (remove && remove.dataset.iconiaRemoveBound !== '1') {
      remove.dataset.iconiaRemoveBound = '1';
      remove.addEventListener('click', e => {
        e.preventDefault(); e.stopImmediatePropagation();
        window.__iconiaPendingImage = null;
        if ($('preview')) $('preview').removeAttribute('src');
        if ($('attach')) $('attach').classList.remove('show');
        syncSend();
      }, true);
    }
    const input = $('text');
    if (input && input.dataset.iconiaInputBound !== '1') {
      input.dataset.iconiaInputBound = '1';
      input.addEventListener('input', syncSend, true);
    }
    stabilize();
    syncSend();
  }

  function schedule() { requestAnimationFrame(() => { bind(); setTimeout(bind, 100); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, {once:true});
  else schedule();
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('orientationchange', () => setTimeout(schedule, 150), {passive:true});
  [0, 100, 400, 1000, 2000].forEach(ms => setTimeout(schedule, ms));
})();
