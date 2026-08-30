export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  try {
    const host = req.headers.host;
    if (!host) throw new Error('HOST_MISSING');
    const r = await fetch(`https://${host}/index.html?iconia_balance=1`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`INDEX_FETCH_${r.status}`);
    let html = await r.text();

    // Keep the application shell intact while adding useful, crawlable service
    // information to the home page. This gives visitors and search crawlers
    // context before/alongside the interactive generator.
    const seoContent = `<section class="seoContent" aria-labelledby="about-iconia">
      <div class="seoInner">
        <h1 id="about-iconia">Iconia AI — ゲームアイコンをAIで作成</h1>
        <p>Iconia AIは、作りたいゲームアイコンのイメージを文章で伝えて、オリジナルの画像を作成できるAIサービスです。キャラクター、色、背景、雰囲気、名前やクラン名などを会話形式で指定できます。</p>
        <div class="seoGrid">
          <article><h2>ゲームアイコンを作る</h2><p>プロフィール用の1:1アイコンを中心に、X / Twitter、YouTube、縦長画像にも対応しています。用途に合わせて出力サイズを選べます。</p></article>
          <article><h2>参考画像を編集する</h2><p>参考画像を追加して、人物や構図をできるだけ維持した編集、部分編集、背景変更、文字・ロゴ調整などを指示できます。</p></article>
          <article><h2>具体的な指示で調整する</h2><p>「青と黒」「キャラクターを大きく」「紫の光を背景に」など、色・構図・表情・文字を具体的に指定すると、希望するイメージを伝えやすくなります。</p></article>
        </div>
        <div class="seoLinks"><a href="/guide.html">使い方を見る</a><a href="/about.html">Iconia AIについて</a><a href="/faq.html">よくある質問</a><a href="/pricing.html">クレジット・料金</a><a href="/privacy.html">プライバシーポリシー</a><a href="/terms.html">利用規約</a></div>
      </div>
    </section>`;
    const seoStyle = `<style>.seoContent{max-width:980px;margin:0 auto;padding:36px 18px 430px;color:#f5f6fb}.seoInner{background:#10131b;border:1px solid #292f40;border-radius:22px;padding:24px}.seoContent h1{font-size:clamp(25px,5vw,38px);line-height:1.25;margin:0 0 14px}.seoContent h2{font-size:18px;margin:0 0 8px}.seoContent p{color:#b7bdcc;line-height:1.85;margin:0}.seoGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:22px}.seoGrid article{background:#171b25;border:1px solid #2b3141;border-radius:16px;padding:17px}.seoLinks{display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}.seoLinks a{color:#c8b7ff;text-decoration:none;border:1px solid #3a4160;border-radius:11px;padding:9px 12px;font-size:13px}.seoLinks a:hover{background:#1b1f2c}@media(max-width:700px){.seoContent{padding:24px 10px 430px}.seoInner{padding:19px}.seoGrid{grid-template-columns:1fr}}</style>`;

    html = html.replace('</head>', `${seoStyle}</head>`);
    html = html.replace('<div class="composerWrap">', `${seoContent}<div class="composerWrap" id="composerWrap">`);
    html = html.replace('<div class="composerWrap" id="composerWrap" id="composerWrap">', '<div class="composerWrap" id="composerWrap">');
    html = html.replace("function syncViewport(){const vv=window.visualViewport;if(!vv)return;const keyboard=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);const composer=$('composerWrap');composer.style.bottom='0px';composer.style.transform=keyboard>80?'translate3d(0,'+(-keyboard)+'px,0)':'translate3d(0,0,0)';document.documentElement.style.setProperty('--vvh',vv.height+'px')}","function syncViewport(){const vv=window.visualViewport;const composer=$('composerWrap');if(!composer)return;if(!vv){composer.style.bottom='0px';composer.style.transform='translate3d(0,0,0)';return}const keyboard=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);composer.style.bottom='0px';composer.style.transform=keyboard>80?'translate3d(0,'+(-keyboard)+'px,0)':'translate3d(0,0,0)';document.documentElement.style.setProperty('--vvh',vv.height+'px')}");
    const script = '<script src="/credit-balance.js?v=2" defer></script>';
    const analytics = '<script src="/analytics.js?v=1" defer></script>';
    const runtime = `<script>(()=>{const fix=()=>{const c=document.querySelector('.composerWrap');if(c){c.id='composerWrap';c.style.setProperty('position','fixed','important');c.style.setProperty('left','0','important');c.style.setProperty('right','0','important');c.style.setProperty('bottom','0','important');c.style.setProperty('top','auto','important');c.style.setProperty('z-index','1000','important')}const b=document.getElementById('attachBtn'),f=document.getElementById('file');if(b&&f&&!b.dataset.iconiaBound){b.dataset.iconiaBound='1';b.type='button';b.addEventListener('click',e=>{e.preventDefault();try{f.showPicker?f.showPicker():f.click()}catch(_){f.click()}})}};fix();setTimeout(fix,100);setTimeout(fix,500);setTimeout(fix,1500)})();</script>`;
    if (!html.includes('/credit-balance.js')) html = html.replace('</body>', `${script}${analytics}${runtime}</body>`);
    else if (!html.includes('/analytics.js')) html = html.replace('</body>', `${analytics}${runtime}</body>`);
    else html = html.replace('</body>', `${runtime}</body>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.status(200).send(html);
  } catch (e) {
    console.error('Iconia app shell error', e);
    return res.status(503).send('Iconia AI を読み込めませんでした。');
  }
}
