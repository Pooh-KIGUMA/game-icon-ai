(() => {
  // Emergency client-side recovery for iPhone/mobile UI.
  // The original page can throw while wiring the viewport/composer, leaving
  // the send button disabled. This file restores the minimum chat/generation
  // path without touching the server-side credit logic.
  if (window.__iconiaMobileFix) return;
  window.__iconiaMobileFix = true;

  const KEY = 'iconia_pro_v6';
  const $ = id => document.getElementById(id);

  function getState() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { messages: [], lastImage: null, versions: [] };
    } catch {
      return { messages: [], lastImage: null, versions: [] };
    }
  }

  function saveState(s) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        messages: (s.messages || []).slice(-80),
        lastImage: s.lastImage || null,
        versions: (s.versions || []).slice(-16)
      }));
    } catch {}
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>\"']/g, m => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;'
    }[m]));
  }

  function ensureComposerId() {
    const c = document.querySelector('.composerWrap');
    if (c && !c.id) c.id = 'composerWrap';
    return c;
  }

  function setSendEnabled() {
    const input = $('text');
    const send = $('send');
    if (!input || !send) return;
    send.disabled = !String(input.value || '').trim() || Boolean(window.__iconiaGenerating);
  }

  function appendMessage(role, text, image) {
    const main = $('main');
    if (!main) return null;
    // Remove the static welcome screen once the first real message is sent.
    const welcome = main.querySelector('.welcome');
    if (welcome) welcome.remove();

    const row = document.createElement('div');
    row.className = `row ${role === 'user' ? 'user' : 'ai'}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (text) bubble.innerHTML = esc(text);
    if (image) {
      const img = document.createElement('img');
      img.className = 'result';
      img.src = image;
      img.alt = '生成画像';
      img.addEventListener('click', () => {
        const box = $('lightbox'), li = $('lightImg');
        if (box && li) { li.src = image; box.classList.add('show'); }
      });
      bubble.appendChild(img);
    }
    row.appendChild(bubble);
    main.appendChild(row);
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
    return row;
  }

  async function generate() {
    const input = $('text');
    const send = $('send');
    if (!input || !send || window.__iconiaGenerating) return;
    const message = String(input.value || '').trim();
    if (!message) return;

    window.__iconiaGenerating = true;
    setSendEnabled();
    input.disabled = true;

    const state = getState();
    const image = typeof state.lastImage === 'string' && state.lastImage.startsWith('data:image/') ? state.lastImage : null;
    const history = Array.isArray(state.messages) ? state.messages.slice(-28) : [];
    const mode = document.querySelector('#modeBar .chip.active')?.dataset.mode || 'auto';
    const format = document.querySelector('#formatBar .chip.active')?.dataset.format || 'icon';

    state.messages = state.messages || [];
    state.messages.push({ role:'user', text:message, image:null });
    saveState(state);
    appendMessage('user', message);
    input.value = '';

    const loading = appendMessage('ai', '考えています…');
    const loadingBubble = loading?.querySelector('.bubble');
    const started = Date.now();
    let timer = setInterval(() => {
      if (!loadingBubble) return;
      const sec = Math.floor((Date.now() - started) / 1000);
      loadingBubble.textContent = sec > 8 ? `画像を生成しています… ${sec}秒` : '考えています…';
    }, 1000);

    try {
      const r = await fetch('/api/generate', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'same-origin',
        body:JSON.stringify({ message, image, history, mode, format })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) throw new Error(data.error || `画像生成に失敗しました (${r.status})`);

      if (loading) loading.remove();
      if (data.chat) {
        appendMessage('ai', data.reply || '了解しました。');
        state.messages.push({ role:'ai', text:data.reply || '了解しました。' });
      } else {
        appendMessage('ai', data.reply || 'できました。', data.image);
        state.lastImage = data.image || state.lastImage;
        state.messages.push({ role:'ai', text:data.reply || 'できました。', image:data.image || null });
        if (data.image) state.versions = [...(state.versions || []), data.image].slice(-16);
      }
      saveState(state);
    } catch (e) {
      if (loadingBubble) {
        loadingBubble.className = 'bubble error';
        loadingBubble.textContent = e?.message || '画像生成中にエラーが発生しました。';
      } else {
        appendMessage('ai', e?.message || '画像生成中にエラーが発生しました。');
      }
    } finally {
      clearInterval(timer);
      window.__iconiaGenerating = false;
      input.disabled = false;
      setSendEnabled();
      input.focus({ preventScroll:true });
    }
  }

  function resetConversation() {
    try { localStorage.setItem(KEY, JSON.stringify({messages:[],lastImage:null,versions:[]})); } catch {}
    const main = $('main');
    if (main) main.innerHTML = '';
    window.__iconiaGenerating = false;
    const input = $('text');
    if (input) { input.value=''; input.disabled=false; }
    if (typeof window.newConversation === 'function') {
      try { window.newConversation(); } catch {}
    }
    setSendEnabled();
  }

  ensureComposerId();

  const input = $('text');
  const send = $('send');
  if (input) {
    input.addEventListener('input', setSendEnabled, true);
    input.addEventListener('change', setSendEnabled, true);
    input.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        generate();
      }
    }, true);
  }

  // Capture-phase interception makes this work even if the original page's
  // event wiring failed earlier.
  document.addEventListener('click', e => {
    const target = e.target?.closest?.('#send');
    if (target) {
      e.preventDefault();
      e.stopImmediatePropagation();
      generate();
      return;
    }
    const newButton = e.target?.closest?.('#newBtn,#sideNew');
    if (newButton) {
      e.preventDefault();
      e.stopImmediatePropagation();
      resetConversation();
    }
  }, true);

  // Ensure the first render is interactive even after a new conversation.
  setTimeout(() => {
    ensureComposerId();
    setSendEnabled();
  }, 50);
  setTimeout(() => {
    ensureComposerId();
    setSendEnabled();
  }, 500);
})();
