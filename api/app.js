export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  try {
    const host = req.headers.host;
    if (!host) throw new Error('HOST_MISSING');
    const r = await fetch(`https://${host}/index.html?iconia_balance=1`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`INDEX_FETCH_${r.status}`);
    let html = await r.text();
    const script = '<script src="/credit-balance.js?v=1" defer></script>';
    if (!html.includes('/credit-balance.js')) html = html.replace('</body>', `${script}</body>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.status(200).send(html);
  } catch (e) {
    console.error('Iconia app shell error', e);
    return res.status(503).send('Iconia AI を読み込めませんでした。');
  }
}
