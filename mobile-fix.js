(() => {
  // iPhone/Safari stabilization only.
  // The main app already owns sending, state, history and generation.
  // Do NOT install a second send/generation handler here: that caused
  // duplicate requests, huge localStorage writes and unstable reloads.
  if (window.__iconiaMobileFixV3) return;
  window.__iconiaMobileFixV3 = true;

  const $ = id => document.getElementById(id);

  function stabilizeViewport() {
    const c = document.querySelector('.composerWrap');
    if (!c) return;
    c.id = c.id || 'composerWrap';
    c.style.setProperty('position', 'fixed', 'important');
    c.style.setProperty('left', '0', 'important');
    c.style.setProperty('right', '0', 'important');
    c.style.setProperty('top', 'auto', 'important');
    c.style.setProperty('bottom', '0', 'important');
    c.style.setProperty('z-index', '1000', 'important');
    // Never translate the composer based on stale iOS visualViewport values.
    c.style.setProperty('transform', 'none', 'important');
    c.style.setProperty('will-change', 'auto', 'important');
  }

  function syncSend() {
    const input = $('text');
    const send = $('send');
    if (!input || !send) return;
    const pending = Boolean(window.__iconiaPendingImage);
    send.disabled = Boolean(window.__iconiaGenerating) || (!String(input.value || '').trim() && !pending);
  }

  // Prevent the page from jumping to the top when iOS opens/closes the keyboard.
  let raf = 0;
  function schedule() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      stabilizeViewport();
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

  // Re-apply after the main app's first render and after a new conversation.
  [0, 100, 400, 1000].forEach(ms => setTimeout(schedule, ms));

  // Keep the composer visible without changing document scroll position.
  document.addEventListener('click', e => {
    const target = e.target?.closest?.('#newBtn,#sideNew');
    if (target) setTimeout(schedule, 50);
  }, true);
})();
