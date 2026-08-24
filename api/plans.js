const plans = {
  free: { id: 'free', name: 'Free', priceJPY: 0, monthlyCredits: 10, ads: true, videoAds: true },
  standard: { id: 'standard', name: 'Standard', priceJPY: 540, monthlyCredits: 60, ads: true, videoAds: false },
  pro: { id: 'pro', name: 'Pro', priceJPY: 1620, monthlyCredits: 180, ads: false, videoAds: false }
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).json({ plans });
}
