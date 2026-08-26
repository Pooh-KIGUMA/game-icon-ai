(() => {
  const DB_NAME = 'iconia-ai-history-v1';
  const STORE = 'sessions';
  const CURRENT_KEY = 'iconia_current_session_id';
  let dbPromise = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const titleOf = (messages) => {
    const m = (messages || []).find(x => x.role === 'user' && x.text);
    return String(m?.text || '新しい会話').replace(/\s+/g,' ').trim().slice(0,70) || '新しい会話';
  };
  const openDb = () => dbPromise || (dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath:'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
  async function putSession(session) { try { const db = await openDb(); await new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readwrite');t.objectStore(STORE).put(session);t.oncomplete=resolve;t.onerror=()=>reject(t.error)}); } catch {} }
  async function getAll() { try { const db=await openDb(); return await new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readonly');const r=t.objectStore(STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)}); } catch { return []; } }
  async function getOne(id) { try { const db=await openDb(); return await new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readonly');const r=t.objectStore(STORE).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)}); } catch { return null; } }
  async function delOne(id) { try { const db=await openDb(); await new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readwrite');t.objectStore(STORE).delete(id);t.oncomplete=resolve;t.onerror=()=>reject(t.error)}); } catch {} }

  let currentId = localStorage.getItem(CURRENT_KEY) || uid();
  localStorage.setItem(CURRENT_KEY, currentId);
  let lastFingerprint = '';

  function snapshot() {
    try { return { id: currentId, title: titleOf(state.messages), createdAt: Number(localStorage.getItem('iconia_session_created_'+currentId) || Date.now()), updatedAt: Date.now(), messages: state.messages.filter(m => !m.loading).slice(-80), lastImage: state.lastImage || null, versions: state.versions || [] }; }
    catch { return null; }
  }
  async function archiveCurrent(force=false) {
    const s=snapshot(); if(!s || !s.messages.length) return;
    const fp = JSON.stringify([s.title,s.messages.length,s.lastImage,s.messages[s.messages.length-1]?.text||'']);
    if(!force && fp===lastFingerprint) return; lastFingerprint=fp; await putSession(s);
  }
  async function syncCurrent() { await archiveCurrent(false); }

  // The balance badge is intentionally a single, clear entry point to billing.
  // Do not open the old plan-only modal here: users could mistake it for the
  // only purchase option. The billing page contains both one-time credit packs
  // and monthly plans.
  function ensureCreditButton() {
    const badge=$('iconiaCredits'); if(!badge)return;
    badge.style.pointerEvents='auto'; badge.style.cursor='pointer'; badge.setAttribute('role','button'); badge.title='クレジットを追加';
    if(!badge.dataset.bound){ badge.dataset.bound='1'; badge.addEventListener('click',()=>{ window.location.href='/pricing.html'; }); }
  }

  async function renderHistory(){
    const d=$('drawer'), h=$('history'); if(!d||!h)return;
    d.classList.add('show'); h.innerHTML='<div class="historyItem">履歴を読み込んでいます…</div>';
    const items=(await getAll()).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,30);
    if(!items.length){h.innerHTML='<div class="historyItem">まだ会話履歴はありません。<br><span class="meta">画像を作ると、ここに自動保存されます。</span></div>';return;}
    h.innerHTML=items.map(s=>{const last=[...(s.messages||[])].reverse().find(m=>m.image);const thumb=last?.image?`<img src="${last.image}" style="width:64px;height:64px;object-fit:cover;border-radius:10px;flex:none">`:'';return `<div class="historyItem" data-history-id="${esc(s.id)}" style="display:flex;gap:10px;align-items:center;cursor:pointer">${thumb}<div style="min-width:0;flex:1"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</b><div class="meta">${new Date(s.updatedAt).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} ・ ${(s.messages||[]).filter(m=>m.role==='user').length}件</div></div><button data-delete-history="${esc(s.id)}" class="remove" style="width:34px;height:34px;font-size:15px">×</button></div>`}).join('');
    h.querySelectorAll('[data-history-id]').forEach(el=>el.onclick=async e=>{if(e.target.closest('[data-delete-history]'))return;const s=await getOne(el.dataset.historyId);if(!s)return;currentId=s.id;localStorage.setItem(CURRENT_KEY,currentId);state={messages:s.messages||[],lastImage:s.lastImage||null,versions:s.versions||[]};try{save()}catch{}d.classList.remove('show');render();scrollBottom();});
    h.querySelectorAll('[data-delete-history]').forEach(btn=>btn.onclick=async e=>{e.stopPropagation();await delOne(btn.dataset.deleteHistory);renderHistory();});
  }

  function newChat(){ archiveCurrent(true).finally(()=>{ currentId=uid();localStorage.setItem(CURRENT_KEY,currentId);localStorage.setItem('iconia_session_created_'+currentId,String(Date.now()));state=fresh();save();render(); }); }
  function bind(){
    ['newBtn','sideNew','clearBtn'].forEach(id=>{const el=$(id);if(!el||el.dataset.historyBound)return;el.dataset.historyBound='1';el.addEventListener('click',e=>{e.stopImmediatePropagation();e.preventDefault();newChat();},true);});
    ['historyBtn','sideHistory'].forEach(id=>{const el=$(id);if(!el||el.dataset.historyBound)return;el.dataset.historyBound='1';el.addEventListener('click',e=>{e.stopImmediatePropagation();e.preventDefault();renderHistory();},true);});
    ensureCreditButton();
  }
  setInterval(()=>{bind();ensureCreditButton();syncCurrent()},1200);
  bind();
  if(!localStorage.getItem('iconia_session_created_'+currentId))localStorage.setItem('iconia_session_created_'+currentId,String(Date.now()));
  window.iconiaHistory={saveNow:archiveCurrent,open:renderHistory,newChat};
})();
