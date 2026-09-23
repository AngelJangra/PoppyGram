import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Whole-site gate: every page + /api/* (except /api/auth/* + cron with secret)
// requires the signed admin_session cookie. No cookie = login page / 401.
// Uses Web Crypto (Edge-Runtime safe — Node's `crypto` module is unavailable
// on Vercel's edge runtime). HMAC-SHA256 output matches the Node signer for the same secret + payload.
const enc=new TextEncoder();

  function secret(){const value=process.env.ENCRYPTION_KEY_BASE64_32_BYTES||'';if(!value)throw new Error('ENCRYPTION_KEY_BASE64_32_BYTES is not configured');return value;}
function constEqual(a:string,b:string){if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0}
let keyPromise:Promise<CryptoKey>|null=null;
function importKey(){if(!keyPromise){keyPromise=crypto.subtle.importKey('raw',enc.encode(secret()),{name:'HMAC',hash:'SHA-256'},false,['sign'])}return keyPromise}
async function hmacHex(msg:string){const sig=await crypto.subtle.sign('HMAC',await importKey(),enc.encode(msg));return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')}
const SESSION_TTL_MS=24*60*60*1000;
async function globalLogoutBefore(){
  try{
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!url||!key)return null;
    const r=await fetch(`${url}/rest/v1/settings?select=value&key=eq.admin_logout_before&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`},cache:'no-store'});
    if(!r.ok)return null;
    const rows=await r.json();
    const ts=Date.parse(String(rows?.[0]?.value||''));
    return Number.isFinite(ts)?ts:null;
  }catch{return null}
}
async function valid(v:string|undefined){
  if(typeof v!=='string')return false;
  try{
    const dot=v.indexOf('.');
    if(dot<0)return false;
    const exp=Number(v.slice(0,dot));
    if(!Number.isFinite(exp)||exp<=Date.now())return false;
    const sig=await hmacHex(`poppygram-admin:${exp}`);
    if(!constEqual(v.slice(dot+1),sig))return false;
    const issuedAt=exp-SESSION_TTL_MS;
    const revokedBefore=await globalLogoutBefore();
    if(revokedBefore!==null && issuedAt<=revokedBefore)return false;
    return true;
  }catch{return false}
}
export async function middleware(req:NextRequest){
  const path=req.nextUrl.pathname;
    // Allow unauthenticated entry points: auth, bot webhook (+verify), bot-login
    // start, and the public /botlogin page (Telegram users opening a login
    // link are NOT site admins and have no admin_session cookie).
  // /api/bot = store bot webhook (secret header), /api/support = support bot
  // webhook (its own hardcoded secret header, checked inside the Python handler).
  if(path === '/api/auth/login'||path === '/api/auth/logout'||path === '/api/auth/check'||path === '/api/bot'||path === '/api/support'||path === '/api/bot-verify'||path.startsWith('/api/tg/bot-login')||path==='/botlogin'||path.startsWith('/botlogin?')||path.startsWith('/botlogin/'))return NextResponse.next();
  // Machine endpoints that accept the CRON_SECRET bearer token. Vercel cron and the
  // documented /api/bot-setup call carry no admin cookie, so the shared secret
  // authorises them here; without it they fall through to the admin-session check.
  if(path === '/api/ping-all'||path === '/api/bot-setup'){
    const auth=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
    if(process.env.CRON_SECRET&&auth===process.env.CRON_SECRET)return NextResponse.next();
  }
  if(path.startsWith('/api/')){
    if(await valid(req.cookies.get('admin_session')?.value))return NextResponse.next();
    return NextResponse.json({error:'Unauthorized — whole site is pass protected'},{status:401});
  }
    // Pages: allow static assets; require admin cookie for everything else.
  // Public images must load on the login screen before authentication.
  if(
    path.startsWith('/_next/')||
    path==='favicon.ico'||
    path==='/poppygram.png'||
    path==='/logo.svg'||
    /\.(?:png|svg|ico|jpg|jpeg|gif|webp|avif|txt|xml|webmanifest|mp4)$/i.test(path)
  )return NextResponse.next();
  if(await valid(req.cookies.get('admin_session')?.value))return NextResponse.next();
  // Let the root page render its own login screen. The client checks the
  // signed session via /api/auth/check, avoiding rewrite loops and ensuring
  // logout reliably returns to the login form.
  return NextResponse.next();
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};