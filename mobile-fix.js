(() => {
  if (window.__iconiaMobileFixV8) return;
  window.__iconiaMobileFixV8 = true;
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
  }

  // iPhone images can easily exceed Vercel's request-body limit. Resize and
  // compress the selected image in the browser before the original upload
  // handler receives it. Also explicitly enable Send after an image is chosen;
  // the original page only updated this state from textarea input.
  async function compressImage(file) {
    if (!file || !file.type.startsWith('image/')) return file;

    const MAX_SIDE = 1600;
    const TARGET_BYTES = 3 * 1024 * 1024;

    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();

      let quality = 0.84;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length * 0.75 > TARGET_BYTES && quality > 0.55) {
        quality -= 0.07;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return new File([blob], 'iconia-reference.jpg', {
        type: 'image/jpeg',
        lastModified: Date.now()
      });
    } catch (_) {
      return file;
    }
  }

  function bindUpload() {
    const button = $('attachBtn');
    const file = $('file');
    if (button && file) {
      button.type = 'button';
      button.style.display = 'inline-grid';
      button.onclick = e => {
        e.preventDefault();
        try {
          if (file.showPicker) file.showPicker();
          else file.click();
        } catch (_) {
          file.click();
        }
      };

      // Preserve the page's original file handler, but feed it a compressed
      // image and then make the send button usable even when no text is typed.
      if (!file.__iconiaUploadBound) {
        const originalChange = file.onchange;
        file.onchange = async e => {
          const selected = e.target.files?.[0];
          if (!selected) return;
          const compressed = await compressImage(selected);
          const originalFiles = e.target.files;

          try {
            const dt = new DataTransfer();
            dt.items.add(compressed);
            e.target.files = dt.files;
          } catch (_) {
            // If iOS blocks assigning input.files, pass a synthetic event to
            // the original handler; the File object is still available here.
          }

          if (typeof originalChange === 'function') {
            const synthetic = { ...e, target: { ...e.target, files: [compressed] } };
            try {
              await originalChange(synthetic);
            } catch (_) {
              // Fall back to the real event if a browser rejects the synthetic target.
              try { await originalChange(e); } catch (_) {}
            }
          }

          const send = $('send');
          if (send) send.disabled = false;
          stabilize();

          // Restore the input's original selection semantics so the same file
          // can be selected again later.
          try { e.target.value = ''; } catch (_) {}
          void originalFiles;
        };
        file.__iconiaUploadBound = true;
      }
    }
    stabilize();
  }

  // Keep the simple-generation fast endpoint, while leaving image edits on
  // the full context-aware endpoint.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url === '/api/generate' && init?.method === 'POST' && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        if (!body.image) {
          return nativeFetch('/api/generate-fast', {
            ...init,
            body: JSON.stringify({ ...body })
          });
        }
      }
    } catch (_) {}
    return nativeFetch(input, init);
  };

  function run() {
    requestAnimationFrame(() => {
      bindUpload();
      setTimeout(bindUpload, 100);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

  window.addEventListener('resize', run, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(run, 150), { passive: true });
  [0, 100, 400, 1000, 2000].forEach(ms => setTimeout(run, ms));
})();
