(() => {
  if (window.__iconiaMobileFixV10) return;
  window.__iconiaMobileFixV10 = true;
  const $ = id => document.getElementById(id);

  function stabilize() {
    const header = document.querySelector('.header');
    if (header && window.innerWidth <= 700) {
      header.style.setProperty('position', 'fixed', 'important');
      header.style.setProperty('top', '0', 'important');
      header.style.setProperty('left', '0', 'important');
      header.style.setProperty('right', '0', 'important');
      header.style.setProperty('z-index', '1100', 'important');
      document.body.style.paddingTop = '64px';
    }
    const composer = document.querySelector('.composerWrap');
    if (composer) {
      composer.style.setProperty('position', 'fixed', 'important');
      composer.style.setProperty('left', '0', 'important');
      composer.style.setProperty('right', '0', 'important');
      composer.style.setProperty('bottom', '0', 'important');
      composer.style.setProperty('top', 'auto', 'important');
      composer.style.setProperty('z-index', '1000', 'important');
    }
    const lightbox = $('lightbox');
    if (lightbox) lightbox.style.zIndex = '3000';
    const lightImg = $('lightImg');
    if (lightImg) {
      lightImg.style.pointerEvents = 'auto';
      lightImg.style.touchAction = 'pinch-zoom';
    }
  }

  async function compressImage(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const MAX_SIDE = 1600;
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      let quality = 0.84;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length * 0.75 > 2.5 * 1024 * 1024 && quality > 0.5) {
        quality -= 0.06;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      const blob = await (await fetch(dataUrl)).blob();
      return new File([blob], 'iconia-reference.jpg', { type: 'image/jpeg' });
    } catch (_) {
      return file;
    }
  }

  function bindUpload() {
    const button = $('attachBtn');
    const file = $('file');
    if (!button || !file) return stabilize();
    button.type = 'button';
    button.style.display = 'inline-grid';
    button.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      try { file.click(); } catch (_) {}
    };
    if (!file.__iconiaUploadBoundV10) {
      const originalChange = file.onchange;
      file.onchange = async e => {
        const input = e.target;
        const selected = input?.files?.[0];
        if (!selected) return;
        let compressed = selected;
        try { compressed = await compressImage(selected); } catch (_) {}
        if (typeof originalChange === 'function') {
          try {
            await originalChange({ target: { files: [compressed], value: '' } });
          } catch (_) {
            try { await originalChange(e); } catch (_) {}
          }
        }
        const send = $('send');
        if (send) {
          send.disabled = false;
          send.style.opacity = '1';
        }
        stabilize();
        try { input.value = ''; } catch (_) {}
      };
      file.__iconiaUploadBoundV10 = true;
    }
    stabilize();
  }

  function bindImageViewer() {
    const main = $('main');
    const lightbox = $('lightbox');
    const lightImg = $('lightImg');
    if (!main || !lightbox || !lightImg) return;
    if (!main.__iconiaViewerBoundV10) {
      const open = src => {
        if (!src) return;
        lightImg.src = src;
        lightbox.classList.add('show');
        lightbox.style.display = 'block';
        document.body.style.overflow = 'hidden';
        stabilize();
      };
      const close = () => {
        lightbox.classList.remove('show');
        lightbox.style.display = '';
        document.body.style.overflow = '';
      };
      main.addEventListener('click', e => {
        const img = e.target.closest?.('.result');
        if (!img) return;
        e.preventDefault();
        e.stopPropagation();
        open(img.currentSrc || img.src || img.dataset.image);
      }, true);
      main.addEventListener('touchend', e => {
        const img = e.target.closest?.('.result');
        if (!img) return;
        e.preventDefault();
        e.stopPropagation();
        open(img.currentSrc || img.src || img.dataset.image);
      }, {capture:true, passive:false});
      lightbox.addEventListener('click', e => {
        if (e.target === lightbox || e.target === $('lightClose')) close();
      });
      $('lightClose')?.addEventListener('touchend', e => { e.preventDefault(); close(); }, {passive:false});
      main.__iconiaViewerBoundV10 = true;
    }
    stabilize();
  }

  function run() {
    requestAnimationFrame(() => {
      bindUpload();
      bindImageViewer();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
  window.addEventListener('resize', run, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(run, 150), { passive: true });
  [100, 500, 1500, 3000].forEach(ms => setTimeout(run, ms));
})();
