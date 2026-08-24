const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hornvpxaxpbwoaooswxm.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_vKpw7fP36fiUBLdTEhXPFg_CN2xpLZG';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control','public,max-age=300,s-maxage=300');
  return res.status(200).json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY });
}
