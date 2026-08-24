(() => {
  const style = document.createElement('style');
  style.textContent = `
    .iconia-image-tools{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}
    .iconia-image-tools button{background:#242938;border:1px solid #34394b;color:#f6f7fb;padding:8px 11px;border-radius:10px;font:700 11px -apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;cursor:pointer}
    .iconia-image-tools button:hover{background:#30364a}
    .iconia-image-tools .primary{background:linear-gradient(135deg,#7657ff,#0bc8ff);border-color:transparent}
  `;
  document.head.appendChild(style);

  const downloadImage = async (src) => {
    const response = await fetch(src);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iconia-ai-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const shareImage = async (src) => {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const file = new File([blob], 'iconia-ai.jpg', { type: blob.type || 'image/jpeg' });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: 'Iconia AI', text: 'Iconia AIで作成した画像', files: [file] });
        return;
      }
      await downloadImage(src);
    } catch (e) {
      if (e?.name !== 'AbortError') alert('画像を共有できませんでした。保存ボタンを試してください。');
    }
  };

  const enhance = () => {
    document.querySelectorAll('.result').forEach((img) => {
      const bubble = img.closest('.bubble');
      if (!bubble || bubble.querySelector('.iconia-image-tools')) return;
      const tools = document.createElement('div');
      tools.className = 'iconia-image-tools';

      const save = document.createElement('button');
      save.className = 'primary';
      save.textContent = '⬇️ 画像を保存';
      save.onclick = async () => {
        save.disabled = true;
        try { await downloadImage(img.dataset.image || img.src); }
        catch { alert('画像を保存できませんでした。画像を長押しして保存してください。'); }
        finally { save.disabled = false; }
      };

      const share = document.createElement('button');
      share.textContent = '↗️ 共有';
      share.onclick = () => shareImage(img.dataset.image || img.src);

      const zoom = document.createElement('button');
      zoom.textContent = '🔍 拡大表示';
      zoom.onclick = () => img.click();

      tools.append(save, share, zoom);
      const hint = bubble.querySelector('.saveHint');
      if (hint) hint.after(tools); else bubble.appendChild(tools);
    });
  };

  enhance();
  new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true });
})();
