import crypto from 'node:crypto';

const cookieName='iconia_uid';
const PACKS={credits_5:{credits:5,amount:150},credits_10:{credits:10,amount:280},credits_20:{credits:20,amount:500},credits_30:{credits:30,amount:690},credits_60:{credits:60,amount:1200},credits_120:{credits:120,amount:2160}};
function send(res,status,body){return res.status(status).json(body)}
function cookie(req,name){const raw=String(req.headers.cookie||'');const found=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`));return found?decodeURIComponent(found.slice(name.length+1)):''}
function cookieSecret(){return process.env.CREDIT_COOKIE_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||'iconia-credit-secret'}
function sign(id){return crypto.createHmac('sha256',cookieSecret()).update(id).digest('hex')}
function decodeCookie(value){const m=String(value||'').match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i);if(!m)return null;const expected=sign(m[1]);try{return crypto.timingSafeEqual(Buffer.from(m[2],'hex'),Buffer.from(expected,'hex'))?m[1]:null}catch{return null}}
async function stripe(url,options={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch(url,{...options,signal:controller.signal});return{ok:r.ok,status:r.status,data:await r.json().catch(()=>({}))}}finally{clearTimeout(timer)}}
async function supabase(url,key,path,options={}){return fetch(`${url}/rest/v1/${path}`,{...options,headers:{apikey:key,'Content-Type':'application/json',...(options.headers||{})}})}
export default async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{error:'GET only'});
  const stripeKey=process.env.STRIPE_SECRET_KEY,supabaseUrl=process.env.SUPABASE_URL,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!stripeKey||!supabaseUrl||!serviceKey)return send(res,503,{error:'Billing is not configured yet.'});
  try{
    const sessionId=String(req.query?.session_id||'');let matches=[];
    if(sessionId){const result=await stripe(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,{headers:{Authorization:`Bearer ${stripeKey}`}});if(!result.ok)return send(res,502,{error:'STRIPE_SESSION_LOOKUP_FAILED'});const s=result.data;if(s?.payment_status==='paid'&&s?.mode==='payment'&&s?.metadata?.type==='credits'&&PACKS[s?.metadata?.product])matches=[s];}
    else{const userId=decodeCookie(cookie(req,cookieName));if(!userId)return send(res,400,{error:'NO_USER_COOKIE'});const since=Math.floor(Date.now()/1000)-7*24*60*60,params=new URLSearchParams({limit:'100','created[gte]':String(since)}),result=await stripe(`https://api.stripe.com/v1/checkout/sessions?${params}`,{headers:{Authorization:`Bearer ${stripeKey}`}});if(!result.ok)return send(res,502,{error:'STRIPE_LOOKUP_FAILED'});const sessions=Array.isArray(result.data?.data)?result.data.data:[];matches=sessions.filter(s=>s.payment_status==='paid'&&s.mode==='payment'&&s.metadata?.type==='credits'&&s.metadata?.user_id===userId&&PACKS[s.metadata?.product]);}
    if(!matches.length)return send(res,200,{ok:true,added:0,message:'No pending purchase found.'});
    let added=0;
    for(const session of matches){const product=PACKS[session.metadata.product],credits=Number(session.metadata.credits||product.credits),userId=String(session.metadata?.user_id||'');if(!userId||credits!==product.credits||Number(session.amount_total||0)!==product.amount)continue;
      const profileRes=await supabase(supabaseUrl,serviceKey,`profiles?id=eq.${encodeURIComponent(userId)}&select=id,credits,purchased_credits`);if(!profileRes.ok)throw new Error(`PROFILE_LOOKUP_FAILED:${await profileRes.text()}`);const profile=(await profileRes.json())?.[0];
      if(!profile){const createRes=await supabase(supabaseUrl,serviceKey,'profiles?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({id:userId,plan:'free',credits:3,monthly_credits:3,monthly_remaining:3,purchased_credits:0,bonus_credits:0})});if(!createRes.ok&&createRes.status!==409)throw new Error(`PROFILE_CREATE_FAILED:${await createRes.text()}`)}
      const purchaseRes=await supabase(supabaseUrl,serviceKey,'credit_purchases?on_conflict=stripe_session_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({stripe_session_id:session.id,user_id:userId,pack_id:session.metadata.product,credits,amount_jpy:product.amount})});if(!purchaseRes.ok)throw new Error(`PURCHASE_RECORD_FAILED:${await purchaseRes.text()}`);const rows=await purchaseRes.json().catch(()=>[]);
      if(Array.isArray(rows)&&rows.length){const current=profile||{credits:3,purchased_credits:0};const patchRes=await supabase(supabaseUrl,serviceKey,`profiles?id=eq.${encodeURIComponent(userId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({credits:Number(current.credits||0)+credits,purchased_credits:Number(current.purchased_credits||0)+credits,updated_at:new Date().toISOString()})});if(!patchRes.ok)throw new Error(`PROFILE_UPDATE_FAILED:${await patchRes.text()}`);added+=credits;}
    }
    const next=String(req.query?.next||'/'),safeNext=next.startsWith('/')&&!next.startsWith('//')?next:'/';
    if(added>0)return res.redirect(303,`${safeNext}${safeNext.includes('?')?'&':'?'}checkout=success&credits=reconciled`);
    return res.redirect(303,`${safeNext}${safeNext.includes('?')?'&':'?'}checkout=success`);
  }catch(error){console.error('Iconia billing reconcile error',error);return send(res,500,{error:'RECONCILE_FAILED'});}
}
