import crypto from 'node:crypto';

const PACKS={credits_5:{credits:5,amount:150},credits_10:{credits:10,amount:280},credits_20:{credits:20,amount:500},credits_30:{credits:30,amount:690},credits_60:{credits:60,amount:1200},credits_120:{credits:120,amount:2160}};
const PLANS={standard:{credits:30,amount:540,interval:'month'},pro:{credits:120,amount:1620,interval:'month'}};
const cookieName='iconia_uid';
function send(res,status,body,headers={}){Object.entries(headers).forEach(([key,value])=>res.setHeader(key,value));res.status(status).json(body)}
function cookie(req,name){const raw=String(req.headers.cookie||'');const found=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`));return found?decodeURIComponent(found.slice(name.length+1)):''}
function cookieSecret(){return process.env.CREDIT_COOKIE_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||'iconia-credit-secret'}
function sign(id){return crypto.createHmac('sha256',cookieSecret()).update(id).digest('hex')}
function decodeCookie(value){const m=String(value||'').match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i);if(!m)return null;const expected=sign(m[1]);try{return crypto.timingSafeEqual(Buffer.from(m[2],'hex'),Buffer.from(expected,'hex'))?m[1]:null}catch{return null}}
function setCookie(res,id){res.setHeader('Set-Cookie',`${cookieName}=${encodeURIComponent(`${id}.${sign(id)}`)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`)}
function resolveAnonymousId(req){return decodeCookie(cookie(req,cookieName))||crypto.randomUUID()}
async function stripeCheckout(params,secret){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/x-www-form-urlencoded'},body:params,signal:controller.signal});const data=await r.json().catch(()=>({}));return{ok:r.ok,status:r.status,data}}finally{clearTimeout(timer)}}
export default async function handler(req,res){
  if(req.method!=='GET'&&req.method!=='POST')return send(res,405,{error:'GET or POST only'});
  const secret=process.env.STRIPE_SECRET_KEY;if(!secret)return send(res,503,{error:'STRIPE_SECRET_KEY is not configured.'});
  const body=req.method==='GET'?(req.query||{}):(req.body||{}),type=body.type==='subscription'?'subscription':'credits',key=String(body.product||body.pack||body.plan||''),product=(type==='subscription'?PLANS:PACKS)[key];
  if(!product)return send(res,400,{error:'Invalid product.',product:key,type});
  try{
    const userId=resolveAnonymousId(req),origin=`https://${req.headers.host}`,params=new URLSearchParams();
    params.set('mode',type==='subscription'?'subscription':'payment');
    params.set('success_url',`${origin}/api/reconcile?session_id={CHECKOUT_SESSION_ID}&next=/pricing.html`);
    params.set('cancel_url',`${origin}/pricing.html?checkout=cancelled`);
    params.set('line_items[0][quantity]','1');params.set('line_items[0][price_data][currency]','jpy');params.set('line_items[0][price_data][unit_amount]',String(product.amount));
    params.set('line_items[0][price_data][product_data][name]',type==='subscription'?`Iconia AI ${key}`:`Iconia AI ${product.credits} Credits`);
    params.set('metadata[user_id]',userId);params.set('metadata[type]',type);params.set('metadata[product]',key);params.set('metadata[credits]',String(product.credits));
    if(type==='subscription'){params.set('line_items[0][price_data][recurring][interval]',product.interval);params.set('subscription_data[metadata][user_id]',userId);params.set('subscription_data[metadata][type]',type);params.set('subscription_data[metadata][product]',key);params.set('subscription_data[metadata][credits]',String(product.credits));}
    const result=await stripeCheckout(params,secret);if(!result.ok){console.error('Stripe checkout error',result.status,result.data?.error||result.data);return send(res,502,{error:result.data?.error?.message||'Stripe checkout failed.',stripeStatus:result.status})}if(!result.data?.url)return send(res,502,{error:'Stripe did not return a checkout URL.'});
    setCookie(res,userId);if(String(body.json||'')==='1')return send(res,200,{ok:true,url:result.data.url},{'Cache-Control':'no-store'});return res.redirect(303,result.data.url);
  }catch(error){console.error('Iconia checkout error',error);if(error?.name==='AbortError')return send(res,504,{error:'Stripeへの接続がタイムアウトしました。もう一度お試しください。'});return send(res,503,{error:'CHECKOUT_SERVICE_UNAVAILABLE',detail:error?.message||'unknown'})}
}
