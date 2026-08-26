import crypto from 'node:crypto';
import https from 'node:https';

const PACKS = { credits_5:{credits:5,amount:150}, credits_10:{credits:10,amount:280}, credits_20:{credits:20,amount:500}, credits_30:{credits:30,amount:690}, credits_60:{credits:60,amount:1200}, credits_120:{credits:120,amount:2160} };
const PLANS = { standard:{credits:30,amount:540,interval:'month'}, pro:{credits:120,amount:1620,interval:'month'} };
const json=(status,body,headers={})=>({statusCode:status,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const redirect=(url,headers={})=>({statusCode:303,headers:{Location:url,...headers},body:''});
function getCookie(req){const raw=String(req.headers.cookie||'');const x=raw.split(';').map(v=>v.trim()).find(v=>v.startsWith('iconia_uid='));return x?decodeURIComponent(x.slice('iconia_uid='.length)):'';}
function secretForCookie(){return process.env.CREDIT_COOKIE_SECRET||process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'iconia-credit-secret';}
function sign(id){return crypto.createHmac('sha256',secretForCookie()).update(id).digest('hex');}
function userId(req){const v=getCookie(req);const m=v.match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i);if(m&&crypto.timingSafeEqual(Buffer.from(m[2],'hex'),Buffer.from(sign(m[1]),'hex')))return m[1];return crypto.randomUUID();}
function cookie(id){return `iconia_uid=${encodeURIComponent(`${id}.${sign(id)}`)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;}
function stripeSession(params,key){const body=params.toString();return new Promise((resolve,reject)=>{const r=https.request({hostname:'api.stripe.com',path:'/v1/checkout/sessions',method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{let raw='';res.setEncoding('utf8');res.on('data',c=>raw+=c);res.on('end',()=>{let data={};try{data=JSON.parse(raw)}catch{}resolve({status:res.statusCode||500,data})})});r.setTimeout(12000,()=>r.destroy(new Error('STRIPE_TIMEOUT')));r.on('error',reject);r.end(body)});}
export default async function handler(req){
 if(!['GET','POST'].includes(req.method))return json(405,{error:'GET or POST only'});
 const stripeKey=process.env.STRIPE_SECRET_KEY;if(!stripeKey)return json(503,{error:'Stripe is not configured yet.'});
 const q=req.method==='GET'?(req.query||{}):(typeof req.body==='string'?JSON.parse(req.body):(req.body||{}));
 const type=q.type==='subscription'?'subscription':'credits';const key=String(q.product||q.pack||q.plan||'');const product=(type==='subscription'?PLANS:PACKS)[key];if(!product)return json(400,{error:'Invalid product.'});
 try{const id=userId(req);const origin=process.env.APP_URL||`https://${req.headers.host}`;const p=new URLSearchParams();p.set('mode',type==='subscription'?'subscription':'payment');p.set('success_url',`${origin}/pricing.html?checkout=success`);p.set('cancel_url',`${origin}/pricing.html?checkout=cancelled`);p.set('line_items[0][quantity]','1');p.set('line_items[0][price_data][currency]','jpy');p.set('line_items[0][price_data][unit_amount]',String(product.amount));p.set('line_items[0][price_data][product_data][name]',type==='subscription'?`Iconia AI ${key}`:`Iconia AI ${product.credits} Credits`);p.set('metadata[user_id]',id);p.set('metadata[type]',type);p.set('metadata[product]',key);p.set('metadata[credits]',String(product.credits));if(type==='subscription'){p.set('line_items[0][price_data][recurring][interval]',product.interval);p.set('subscription_data[metadata][user_id]',id);p.set('subscription_data[metadata][type]',type);p.set('subscription_data[metadata][product]',key);p.set('subscription_data[metadata][credits]',String(product.credits));}
 const r=await stripeSession(p,stripeKey);if(r.status<200||r.status>=300)return json(r.status,{error:r.data?.error?.message||'Stripe checkout failed.'});const h={'Set-Cookie':cookie(id)};if(r.data?.url)return redirect(r.data.url,h);return json(502,{error:'Stripe did not return a checkout URL.'},h);
 }catch(e){console.error('checkout2',e);return json(504,{error:e?.message==='STRIPE_TIMEOUT'?'Stripeへの接続がタイムアウトしました。':'決済サービスに接続できませんでした。'});}
}
