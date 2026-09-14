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
async function valid(v:string|undefined){
  if(typeof v!=='string')return false;
  try{
    const dot=v.indexOf('.');
    if(dot<0)return false;
    const exp=Number(v.slice(0,dot));
    if(!Number.isFinite(exp)||exp<=Date.now())return false;
    const sig=await hmacHex(`poppygram-admin:${exp}`);
    return constEqual(v.slice(dot+1),sig);
  }catch{return false}
}
export async function middleware(req:NextRequest){
  const path=req.nextUrl.pathname;
    // Allow unauthenticated entry points: auth, bot webhook (+verify), bot-login
    // start, and the public /botlogin page (Telegram users opening a login
    // link are NOT site admins and have no admin_session cookie).
  if(path.startsWith('/api/auth/')||path === '/api/bot'||path === '/api/bot-verify'||path.startsWith('/api/tg/bot-login')||path==='/botlogin'||path.startsWith('/botlogin?')||path.startsWith('/botlogin/'))return NextResponse.next();
  if(path === '/api/ping-all'){
    const auth=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
    if(process.env.CRON_SECRET&&auth===process.env.CRON_SECRET)return NextResponse.next();
    // Otherwise require the normal admin session; browser scheduler uses this path.
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
    /\.(?:png|svg|ico|jpg|jpeg|gif|webp|avif|txt|xml|webmanifest)$/i.test(path)
  )return NextResponse.next();
  if(await valid(req.cookies.get('admin_session')?.value))return NextResponse.next();
  // FIX #7: Unauthenticated users are redirected to the login page.
  const url=req.nextUrl.clone();
  url.pathname='/';
  url.search='';
  return NextResponse.rewrite(url);
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};