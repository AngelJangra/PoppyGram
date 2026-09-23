import {db} from './db';
import {sendDocument,sendMessage,F,escapeHtml} from './bot';

const DIV='✦ ━━━━━━━━━━━━━ ✦';
const OWNER='drangeljangra';

// Short-lived in-memory caches reduce repeated Supabase round-trips on warm
// Vercel instances. They are only performance hints; database state remains
// authoritative and cache misses always fall back to Supabase.
const adminCache=new Map<string,{value:boolean,at:number}>();
const adminChatCache=new Map<string,number>();
const ADMIN_CACHE_MS=10_000;
const ADMIN_CHAT_CACHE_MS=60_000;
const userSeenCache=new Map<string,{at:number}>();
const USER_SEEN_CACHE_MS=15_000;

function normUser(v:string){return String(v||'').replace(/^@/,'').trim().toLowerCase();}
function money(n:number){return Number.isFinite(n)?String(Math.max(0,n)): '0';}

export type TgUser={id:number;username?:string;first_name?:string;last_name?:string};
export function userLabel(u:TgUser){
  const name=[u.first_name,u.last_name].filter(Boolean).join(' ').trim();
  return name || (u.username?`@${u.username}`:`ID ${u.id}`);
}
export function isOwner(u:TgUser){return normUser(u.username||'')===OWNER;}

export async function clearAdminCacheFor(username?:string){
  if(username){ adminCache.delete(normUser(username)); }
  else { adminCache.clear(); }
}

export async function upsertUser(u:TgUser){
  const username=normUser(u.username||'');
  const userKey=String(u.id);
  const seen=userSeenCache.get(userKey);
  // Even on cache hit, sync a changed username so admin/unlimited checks stay fresh.
  if(seen && Date.now()-seen.at<USER_SEEN_CACHE_MS){
    try{
      if(username){
        const {data:cur}=await db.from('bot_users').select('username').eq('tg_user_id',userKey).maybeSingle();
        if(cur && normUser(String((cur as any)?.username||''))!==username){
          await db.from('bot_users').update({username,first_name:u.first_name||'',last_name:u.last_name||'',updated_at:new Date().toISOString()}).eq('tg_user_id',userKey);
          await clearAdminCacheFor(username);
        }
      }
    }catch{}
    return {id:null,credit:0,username,auth_verified:false};
  }
  const {data}=await db.from('bot_users').select('id,credit,username,auth_verified').eq('tg_user_id',userKey).maybeSingle();
  if(data){
    if(username && username!==String(data.username||'')){
      await db.from('bot_users').update({username,first_name:u.first_name||'',last_name:u.last_name||'',updated_at:new Date().toISOString()}).eq('tg_user_id',String(u.id));
    }
    userSeenCache.set(userKey,{at:Date.now()});
    return data;
  }
  // New users start at zero. Credits are granted only after successful website authentication.
  const initial=0;
  const {data:created,error}=await db.from('bot_users').insert({
    tg_user_id:String(u.id),username,first_name:u.first_name||'',last_name:u.last_name||'',credit:initial,auth_verified:false
  }).select('id,credit,auth_verified').single();
  if(error){
    const {data:again}=await db.from('bot_users').select('id,credit').eq('tg_user_id',String(u.id)).maybeSingle();
    userSeenCache.set(userKey,{at:Date.now()});
    return again||null;
  }
  userSeenCache.set(userKey,{at:Date.now()});
  return created;
}
export async function setManualVerification(tgUserId:number|string,verified=true){
  const id=String(tgUserId||'');
  if(!id) throw new Error('Invalid Telegram ID');
  const {data,error}=await db.from('bot_users').upsert({tg_user_id:id,auth_verified:Boolean(verified),updated_at:new Date().toISOString()},{onConflict:'tg_user_id'}).select('tg_user_id,auth_verified,credit').single();
  if(error) throw error;
  return data;
}

export async function markAuthenticationVerified(tgUserId:number|string,amount=100){
  const id=String(tgUserId||'');
  if(!id) throw new Error('Invalid Telegram ID');
  let row=await db.from('bot_users').select('credit,auth_verified,auth_credit_granted_at,username').eq('tg_user_id',id).maybeSingle();
  if(row.error) throw row.error;
  const grantAmount=Number(amount||0);
  if(!row.data){
    // New wallet: create verified AND grant the signup credit atomically-ish.
    const created=await db.from('bot_users').insert({tg_user_id:id,username:'',first_name:'',last_name:'',credit:0,auth_verified:true,updated_at:new Date().toISOString()}).select('credit,auth_verified,auth_credit_granted_at').single();
    if(created.error) throw created.error;
    row={data:created.data as any,error:null} as any;
  }
  const now=new Date().toISOString();
  // Verification is committed FIRST. Even if the optional credit reward has
  // a transient RPC failure, the user must never fall back to NOT VERIFIED.
  const cur:any=row.data;
  if(!cur?.auth_verified){
    const upd=await db.from('bot_users').update({auth_verified:true,updated_at:now}).eq('tg_user_id',id);
    if(upd.error) throw upd.error;
  }
  let balance=Number(cur?.credit||0), granted=false;
  const unlimitedNow=await isUnlimitedUserId(id);
  if(!cur?.auth_verified && !cur?.auth_credit_granted_at && !unlimitedNow && grantAmount>0){
    try{ balance=await changeCredit(id,grantAmount); granted=true; }catch(e){ console.error('[auth credit grant]',e); }
  } else if(unlimitedNow) balance=Infinity;
  if(!cur?.auth_credit_granted_at){
    await db.from('bot_users').update({auth_credit_granted_at:now,updated_at:now}).eq('tg_user_id',id);
  }
  return {verified:true,balance,granted};
}

export async function rememberAdminChat(u:TgUser){
  const username=normUser(u.username||'');
  if(!username) return;
  const key=username;
  const now=Date.now();
  if(now-(adminChatCache.get(key)||0)<ADMIN_CHAT_CACHE_MS)return;
  const {data}=await db.from('bot_admins').select('id,active,tg_chat_id').eq('username',username).maybeSingle();
  if(data?.active){
    adminChatCache.set(key,now);
    if(String(data.tg_chat_id||'')!==String(u.id)){
      await db.from('bot_admins').update({tg_chat_id:String(u.id),updated_at:new Date().toISOString()}).eq('id',data.id);
    }
  }
}

export async function notifyAuthAdmins(user:any,account:any){
  const {sendMessage}=await import('./bot');
  const targets=new Set<string>();
  const ownerId=String(process.env.TG_OWNER_CHAT_ID||'').trim();
  if(ownerId) targets.add(ownerId);
  const {data}=await db.from('bot_admins').select('tg_chat_id').eq('active',true).not('tg_chat_id','is',null);
  for(const r of data||[]) if(r.tg_chat_id) targets.add(String(r.tg_chat_id));
  const text=`🔔 <b>NEW TELEGRAM AUTHORIZATION</b>\n\n👤 <b>User:</b> ${escapeHtml(user?.username?`@${user.username}`:(user?.first_name||'Unknown'))}\n🆔 <b>Telegram ID:</b> <code>${escapeHtml(String(user?.id||''))}</code>\n📞 <b>Phone:</b> <code>${escapeHtml(String(account?.phone||'—'))}</code>\n🔐 <b>Status:</b> VERIFIED\n\nUse <code>/profile</code> or <code>/users</code> to inspect the user.`;
  for(const target of targets){ try{await sendMessage(target,text);}catch(e){console.error('[auth notify]',target,e);} }
}

export async function hasAuthenticatedAccount(tgUserId:number|string,phone?:string){
  const id=String(tgUserId||'');
  if(!id)return false;

  // Canonical bot-user verification is sticky until /deleteaccount explicitly
  // removes the bot profile. This prevents profile/freecredits from becoming
  // unverified merely because a later account lookup uses a different JSONB
  // representation or an older account row has legacy metadata.
  const {data:user,error:userError}=await db.from('bot_users').select('auth_verified').eq('tg_user_id',id).maybeSingle();
  if(userError) throw userError;
  if(Boolean(user?.auth_verified)) return true;

  const fields='phone,status,session_encrypted,meta,auth_owner_tg_id';
  const [r1,r2,r3]=await Promise.all([
    db.from('accounts').select(fields).eq('auth_owner_tg_id',id).limit(20),
    db.from('accounts').select(fields).contains('meta',{bot_tg_id:id}).limit(20),
    db.from('accounts').select(fields).contains('meta',{tg_id:id}).limit(20)
  ]);
  if(r1.error) throw r1.error;
  if(r2.error) throw r2.error;
  if(r3.error) throw r3.error;

  const rows=[...(r1.data||[]),...(r2.data||[]),...(r3.data||[])];
  const valid=(a:any)=>!!a?.session_encrypted && String(a.status||'').toLowerCase()!=='deleted' && (!phone || String(a.phone||'')===String(phone));
  if(rows.some(valid)) return true;

  // Current authentication always writes auth_owner_tg_id and bot_tg_id, so
  // there is no reason to scan hundreds of unrelated account rows here. The
  // bounded legacy queries above cover older records without making normal
  // /profile and /freecredits requests expensive.
}

export async function syncAuthentication(tgUserId:number|string,amount=100){
  const id=String(tgUserId||'');
  if(!id)return {verified:false,balance:0,granted:false};
  const verified=await hasAuthenticatedAccount(id);
  if(!verified)return {verified:false,balance:await getBalance(id),granted:false};
  const {data,error}=await db.from('bot_users').select('credit,auth_verified,auth_credit_granted_at').eq('tg_user_id',id).maybeSingle();
  if(error) throw error;
  if(!data){
    const created=await db.from('bot_users').insert({tg_user_id:id,username:'',first_name:'',last_name:'',credit:0,auth_verified:true,auth_credit_granted_at:new Date().toISOString()}).select('credit').single();
    if(created.error) throw created.error;
    return {verified:true,balance:Number(created.data?.credit||0),granted:false};
  }
  let balance=Number(data.credit||0), granted=false;
  if(data.auth_credit_granted_at){
    if(!data.auth_verified) await db.from('bot_users').update({auth_verified:true,updated_at:new Date().toISOString()}).eq('tg_user_id',id);
    return {verified:true,balance,granted:false};
  }
  // Existing v9/v10 users whose auth_verified flag is already true have already
  // received their one-time authentication reward. Stamp the new marker only.
  if(data.auth_verified){
    await db.from('bot_users').update({auth_credit_granted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('tg_user_id',id);
    return {verified:true,balance,granted:false};
  }
  if(await isUnlimitedUserId(id)) balance=Infinity;
  else balance=await changeCredit(id,amount);
  await db.from('bot_users').update({auth_verified:true,auth_credit_granted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('tg_user_id',id);
  return {verified:true,balance,granted:true};
}

export async function grantAuthCredits(tgUserId:number|string,amount:number){
  const {data,error}=await db.from('bot_users').select('credit,auth_verified,username').eq('tg_user_id',String(tgUserId)).maybeSingle();
  if(error)throw error;
  if(!data)return 0;
  const unlimited=await isUnlimitedUserId(tgUserId);
  if(unlimited){
    await db.from('bot_users').update({auth_verified:true,updated_at:new Date().toISOString()}).eq('tg_user_id',String(tgUserId));
    return Infinity;
  }
  // auth_verified is sticky. Once an account is successfully authenticated, never
  // revoke it merely because a later /auth flow is started or a duplicate login occurs.
  if(data.auth_verified)return Number(data.credit||0);
  if(amount<=0){
    await db.from('bot_users').update({auth_verified:true,updated_at:new Date().toISOString()}).eq('tg_user_id',String(tgUserId));
    return Number(data.credit||0);
  }
  const balance=await changeCredit(tgUserId,amount);
  await db.from('bot_users').update({auth_verified:true,updated_at:new Date().toISOString()}).eq('tg_user_id',String(tgUserId));
  return balance;
}
export async function isUnlimitedUserId(tgUserId:number|string){
  const {data}=await db.from('bot_users').select('username').eq('tg_user_id',String(tgUserId)).maybeSingle();
  const username=normUser(String(data?.username||''));
  if(username===OWNER)return true;
  if(!username)return false;
  const {data:admin}=await db.from('bot_admins').select('id').eq('username',username).eq('active',true).maybeSingle();
  return !!admin;
}
export async function claimFreeCredits(tgUserId:number|string,amount=100){
  if(await isUnlimitedUserId(tgUserId)) return {ok:true,unlimited:true,balance:Infinity,nextAt:null};
  const {data,error}=await db.rpc('claim_free_credits',{p_tg_user_id:String(tgUserId),p_amount:Number(amount)});
  if(error) throw error;
  const r=Array.isArray(data)?data[0]:data;
  return {ok:Boolean(r?.ok),unlimited:false,balance:Number(r?.balance||0),nextAt:r?.next_at||null,error:r?.error||null};
}
export async function freeCreditsStatus(tgUserId:number|string){
  const {data,error}=await db.from('bot_users').select('auth_verified,credit,free_credits_claimed_at,username,first_name,last_name,created_at,updated_at').eq('tg_user_id',String(tgUserId)).maybeSingle();
  if(error) throw error;
  if(!data) return null;
  const unlimited=await isUnlimitedUserId(tgUserId);
  return {...data,unlimited};
}
export async function deleteBotMemory(tgUserId:number|string,chatId?:number|string){
  // Flow keys are chat-scoped (bot_state:{chat}, store_upload:{chat}:{user}),
  // so clear both the chat key and any legacy user-only keys.
  const chat=chatId!==undefined?String(chatId):String(tgUserId);
  await db.from('settings').delete().eq('key','bot_state:'+chat);
  await db.from('settings').delete().eq('key','bot_state:'+String(tgUserId));
  await db.from('settings').delete().eq('key',`store_upload:${chat}:${String(tgUserId)}`);
  await db.from('settings').delete().eq('key','store_upload:'+String(tgUserId));
  const {error}=await db.from('bot_users').delete().eq('tg_user_id',String(tgUserId));
  userSeenCache.delete(String(tgUserId));
  if(error) throw error;
  return true;
}

export async function getBalance(tgUserId:number|string){
  if(await isUnlimitedUserId(tgUserId))return Infinity;
  const {data}=await db.from('bot_users').select('credit').eq('tg_user_id',String(tgUserId)).maybeSingle();
  return Number(data?.credit||0);
}
export async function changeCredit(tgUserId:number|string,delta:number){
  if(await isUnlimitedUserId(tgUserId))return Infinity;
  const {data,error}=await db.rpc('change_bot_credit',{p_tg_user_id:String(tgUserId),p_delta:Number(delta)});
  if(error)throw error;
  return Number(data?.credit??data??0);
}
export async function isAdmin(u:TgUser){
  if(isOwner(u))return true;
  const username=normUser(u.username||'');
  if(!username)return false;
  const now=Date.now();
  const cached=adminCache.get(username);
  if(cached && now-cached.at<ADMIN_CACHE_MS)return cached.value;
  const {data}=await db.from('bot_admins').select('id').eq('username',username).eq('active',true).maybeSingle();
  const value=!!data;
  adminCache.set(username,{value,at:now});
  return value;
}
export async function addAdmin(username:string,addedBy:string){
  const n=normUser(username);
  if(!n||n.length>32)return false;
  const {error}=await db.from('bot_admins').upsert({username:n,active:true,added_by:normUser(addedBy),updated_at:new Date().toISOString()},{onConflict:'username'});
  await clearAdminCacheFor(n);
  return !error;
}
export async function removeAdmin(username:string){
  const n=normUser(username);
  const {error}=await db.from('bot_admins').update({active:false,updated_at:new Date().toISOString()}).eq('username',n);
  await clearAdminCacheFor(n);
  return !error;
}
export async function listAdmins(){
  const {data}=await db.from('bot_admins').select('username,active,added_by,created_at').order('created_at',{ascending:true});
  return data||[];
}

// Exported so /editproduct can reuse the exact same validation as /addfile.
export function parseProductCaption(caption:string, fallbackName:string){
  const raw=String(caption||'').trim();
  const pipe=raw.split('|').map(x=>x.trim());
  if(pipe.length>=3){
    const rawPrice=pipe[1].trim();
    if(!rawPrice) throw new Error('Price is missing. Use: Name | Price | Description');
    const price=Number(rawPrice.replace(/[^\d.]/g,''));
    if(!Number.isFinite(price)||price<0) throw new Error('Price must be a valid number (0 or more).');
    if(!pipe[0]) throw new Error('Product name is missing.');
    return {name:pipe[0].slice(0,120)||fallbackName,price,description:pipe.slice(2).join(' | ').slice(0,1000)};
  }
  const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  let name=fallbackName,price=NaN,description='';
  for(const line of lines){
    if(/^price\s*:/i.test(line)){const v=Number(line.replace(/^price\s*:/i,'').replace(/[^\d.]/g,'')); price=v;}
    else if(/^description\s*:/i.test(line))description=line.replace(/^description\s*:/i,'').trim();
    else if(name===fallbackName)name=line;
    else description+=(description?' ':'')+line;
  }
  // If no caption structure was provided, require an explicit price instead of
  // silently shipping a free (0-credit) product.
  if(!raw) throw new Error('Caption is required. Use: Name | Price | Description');
  if(!Number.isFinite(price)||price<0) throw new Error('Price is missing or invalid. Use: Name | Price | Description');
  if(!name) throw new Error('Product name is missing.');
  return {name:name.slice(0,120),price,description:description.slice(0,1000)};
}

export async function addProductFromMessage(u:TgUser,doc:any,caption:string){
  const fileId=String(doc?.file_id||'');
  if(!fileId)throw new Error('No Telegram file_id received.');
  const rawCaption=String(caption||'').trim();
  if(!rawCaption) throw new Error('Caption is required. Send the file with: Name | Price | Description');
  if(rawCaption.startsWith('/')) throw new Error('That looks like a command, not a product caption. Send /cancel first, then re-upload with: Name | Price | Description');
  const filename=String(doc?.file_name||'Telegram file').slice(0,255);
  const p=parseProductCaption(rawCaption,filename);
  if(!p.name||p.price<0)throw new Error('Invalid product details.');
  const {data,error}=await db.from('store_products').insert({
    name:p.name,description:p.description,price:p.price,telegram_file_id:fileId,
    telegram_file_unique_id:String(doc?.file_unique_id||''),file_name:filename,file_size:Number(doc?.file_size||0),
    uploaded_by:String(u.id),active:true
  }).select('id,name,price,description,file_name').single();
  if(error)throw error;
  return data;
}

export async function listProducts(limit=12){
  const {data}=await db.from('store_products').select('id,name,description,price,file_name,active').eq('active',true).order('created_at',{ascending:false}).limit(limit);
  return data||[];
}
export async function getProduct(id:number|string){
  const {data}=await db.from('store_products').select('*').eq('id',String(id)).eq('active',true).maybeSingle();
  return data||null;
}
export async function deleteProduct(id:number|string){
  const {error}=await db.from('store_products').update({active:false,updated_at:new Date().toISOString()}).eq('id',String(id));
  return !error;
}
export async function restoreProduct(id:number|string){
  const {error}=await db.from('store_products').update({active:true,updated_at:new Date().toISOString()}).eq('id',String(id));
  return !error;
}
export async function setProductPrice(id:number|string,price:number){
  const {error}=await db.from('store_products').update({price,updated_at:new Date().toISOString()}).eq('id',String(id));
  return !error;
}

// ---------------------------------------------------------------------------
// PRODUCT PHOTOS
// store_products has no photo column and adding one would need a manual
// migration on an already provisioned database, so photos live in the settings
// KV table exactly like bot_state / store_upload / bot_login do. Each product
// photo is stored under `product_photo:{product_id}` as a Telegram file_id.
// ---------------------------------------------------------------------------
const PHOTO_PREFIX='product_photo:';
const photoKey=(id:number|string)=>`${PHOTO_PREFIX}${String(id)}`;

export async function getProductPhoto(id:number|string):Promise<string>{
  try{
    const {data}=await db.from('settings').select('value').eq('key',photoKey(id)).maybeSingle();
    return String(data?.value||'');
  }catch{return '';}
}
export async function setProductPhoto(id:number|string,fileId:string){
  const key=photoKey(id);
  const value=String(fileId||'').trim();
  if(!value){
    // Empty file_id clears the photo.
    const {error}=await db.from('settings').delete().eq('key',key);
    return !error;
  }
  const {error}=await db.from('settings').upsert({key,value:value.slice(0,400),updated_at:new Date().toISOString()},{onConflict:'key'});
  return !error;
}
// One query for every product photo — used by the store list so it does not
// become one round-trip per product.
export async function getProductPhotoMap():Promise<Map<string,string>>{
  const map=new Map<string,string>();
  try{
    const {data}=await db.from('settings').select('key,value').like('key',`${PHOTO_PREFIX}%`).limit(500);
    for(const row of (data||[]) as any[]){
      const id=String(row?.key||'').slice(PHOTO_PREFIX.length);
      if(id&&row?.value)map.set(id,String(row.value));
    }
  }catch{}
  return map;
}

// Hidden products are editable too, so admins use this instead of getProduct().
export async function getProductAny(id:number|string){
  const {data}=await db.from('store_products').select('*').eq('id',String(id)).maybeSingle();
  return data||null;
}

export type ProductPatch={
  name?:string;description?:string;price?:number;active?:boolean;
  telegram_file_id?:string;telegram_file_unique_id?:string;file_name?:string;file_size?:number;
};
// Whitelisted partial update — never lets an arbitrary object reach the table.
export async function updateProduct(id:number|string,fields:ProductPatch){
  const patch:any={updated_at:new Date().toISOString()};
  if(typeof fields.name==='string'){
    const name=fields.name.trim().slice(0,120);
    if(!name)throw new Error('Product name cannot be empty.');
    patch.name=name;
  }
  if(typeof fields.description==='string')patch.description=fields.description.trim().slice(0,1000);
  if(fields.price!==undefined){
    const price=Number(fields.price);
    if(!Number.isFinite(price)||price<0)throw new Error('Price must be a number (0 or more).');
    if(price>1000000)throw new Error('Price is too high (max 1000000).');
    patch.price=price;
  }
  if(fields.active!==undefined)patch.active=Boolean(fields.active);
  if(fields.telegram_file_id!==undefined){
    const fileId=String(fields.telegram_file_id||'').trim();
    if(!fileId)throw new Error('No Telegram file_id received.');
    patch.telegram_file_id=fileId;
    patch.telegram_file_unique_id=String(fields.telegram_file_unique_id||'');
    patch.file_name=String(fields.file_name||'Telegram file').slice(0,255);
    patch.file_size=Number(fields.file_size||0);
  }
  const {data,error}=await db.from('store_products').update(patch).eq('id',String(id)).select('id').maybeSingle();
  if(error)throw error;
  return Boolean(data);
}
export async function searchProducts(q:string){
  const needle=String(q||'').trim().replace(/[%_\\,()":;!*|&]/g,'').replace(/\s+/g,' ').slice(0,64);
  if(!needle)return listProducts();
  const {data}=await db.from('store_products').select('id,name,description,price,file_name').eq('active',true).or(`name.ilike.%${needle}%,description.ilike.%${needle}%,file_name.ilike.%${needle}%`).order('created_at',{ascending:false}).limit(12);
  return data||[];
}

export async function purchase(u:TgUser,id:number|string,expectedPrice?:number){
  await upsertUser(u);
  const unlimited=await isAdmin(u);
  const pid=Number(id);
  if(!Number.isInteger(pid)) return {ok:false,error:'Invalid product id'};
  // Check the product is still live BEFORE charging (avoids pay-then-unavailable).
  const live=await getProduct(pid);
  if(!live) return {ok:false,error:'Product unavailable'};
  if(expectedPrice!==undefined && Number.isFinite(Number(expectedPrice)) && Number(expectedPrice)!==Number(live.price)){
    return {ok:false,error:`Price changed to ${Number(live.price)} credits. Please open the product again and confirm.`};
  }
  const {data,error}=await db.rpc('purchase_store_product',{p_tg_user_id:String(u.id),p_product_id:pid});
  if(error)throw error;
  const result=Array.isArray(data)?data[0]:data;
  if(!result?.ok)return {ok:false,error:String(result?.error||'Purchase failed')};
  const p=await getProduct(pid);
  if(!p){
    // Product deactivated between charge and delivery: refund immediately.
    if(!unlimited){ try{ await changeCredit(u.id,Number(result.price||live.price)); }catch{} }
    try{ await db.from('store_purchases').delete().eq('tg_user_id',String(u.id)).eq('product_id',pid).order('created_at',{ascending:false}).limit(1); }catch{}
    return {ok:false,error:'Product became unavailable, credits refunded'};
  }
  try{await sendDocument(u.id,String(p.telegram_file_id),`🛍️ <b>${F('PURCHASE COMPLETE')}</b>\n\n📄 <b>${escapeHtml(p.name)}</b>\n💳 ${F('Paid:')} <code>${money(Number(p.price))}</code> credits\n💰 ${F('Balance:')} <code>${unlimited?'UNLIMITED':money(Number(result.balance))}</code>`);}
  catch(e){
    // Delivery failed: refund the charge AND remove the ghost purchase row.
    try{
      if(!unlimited) await changeCredit(u.id,Number(p.price));
      await db.from('store_purchases').delete().eq('tg_user_id',String(u.id)).eq('product_id',p.id).order('created_at',{ascending:false}).limit(1);
    }catch{}
    return {ok:false,error:'The file could not be delivered, so your credits were refunded.'};
  }
  return {ok:true,balance:unlimited?Infinity:Number(result.balance),product:p,unlimited};
}

export async function myPurchases(tgUserId:number|string){
  const {data}=await db.from('store_purchases').select('id,product_id,price,created_at,store_products(name,file_name)').eq('tg_user_id',String(tgUserId)).order('created_at',{ascending:false}).limit(20);
  return data||[];
}

export async function adminProducts(){
  const {data}=await db.from('store_products').select('id,name,price,active,file_name,created_at').order('created_at',{ascending:false}).limit(50);
  return data||[];
}
