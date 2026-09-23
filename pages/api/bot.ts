import {db} from '../../lib/db';
import type {NextApiRequest,NextApiResponse} from 'next';
import {sendMessage,sendPhoto,getMe,F,escapeHtml,answerCallbackQuery,setMyCommands,BOT_COMMANDS,ADMIN_BOT_COMMANDS} from '../../lib/bot';
import {PROJECT_NAME,GITHUB_USERNAME,GITHUB_URL,SUPPORT_BOT,SUPPORT_URL,creditsCard,creditButtons} from '../../lib/credits';
import {startAuth,handlePhone,clearState,getStateSafe,deleteLoginTicketsForChat,getUploadPending,setUploadPending,clearUploadPending,getEditState,setEditState,clearEditState} from '../../lib/botFlow';
import type {EditState} from '../../lib/botFlow';
import {
  upsertUser,getBalance,isOwner,isAdmin,addAdmin,removeAdmin,listAdmins,rememberAdminChat,setManualVerification,clearAdminCacheFor,
  addProductFromMessage,listProducts,getProduct,deleteProduct,restoreProduct,setProductPrice,
  getProductAny,updateProduct,getProductPhoto,setProductPhoto,getProductPhotoMap,
  searchProducts,purchase,myPurchases,adminProducts,changeCredit,userLabel,claimFreeCredits,freeCreditsStatus,deleteBotMemory,hasAuthenticatedAccount,syncAuthentication,parseProductCaption
} from '../../lib/storeFlow';

const DIV='✦ ━━━━━━━━━━━━━ ✦';
const OWNER='drangeljangra';

const GREETING=`✨ <b>${F('Welcome to POPPYGRAM')}</b> ✨
🛍️ <i>${F('Premium Telegram Store')}</i> 💎
👑 <i>by ${F('drangeljangra')}</i>

${DIV}

🔐 ${F('Verify your Telegram account')}
🛍️ ${F('Browse the file store')}
💳 ${F('Use your credits to unlock files')}
📦 ${F('Keep your purchased files available in Telegram')}
🆘 ${F('Contact support anytime')}

${DIV}

👇 <b>${F('Quick actions')}</b> 👇`;

const HELP=`📖 <b>${F('COMMAND MENU')}</b> 📖

${DIV}

🚀 /start — ${F('Open the bot')}
🛍️ /store — ${F('Browse the file store')}
🔎 /search — ${F('Search products')}
📄 /product — ${F('View a product')}
💳 /balance — ${F('Check credits')}
📦 /history — ${F('Purchase history')}
🎁 /freecredits — ${F('Claim 100 free credits after authentication')}
👤 /profile — ${F('View your profile, credits and account status')}
🗑️ /deleteaccount — ${F('Delete bot memory only; server account remains')}
🔐 /auth — ${F('Add your Telegram account')}
🆘 /support — ${F('Contact PoppyGram support')}
💎 /credits — ${F('Project credits and developer')}
🚫 /cancel — ${F('Cancel the current process')}
❓ /help — ${F('Show this menu')}

${DIV}

💡 ${F('Send')} <code>/store</code> ${F('to start shopping.')}`;

const ADMIN_HELP=`🛡️ <b>${F('ADMIN COMMANDS')}</b>

${DIV}

📤 /addfile — ${F('Upload a file as a store product')}
✏️ /editproduct — ${F('Edit name, price, description, photo or file')}
🩺 /status — ${F('Check webhook health')}
🔄 /syncmenu — ${F('Refresh the Telegram command menu')}
📋 /products — ${F('List all products')}
🗑️ /delproduct ID — ${F('Hide a product')}
♻️ /restoreproduct ID — ${F('Restore a hidden product')}
💰 /setprice ID PRICE — ${F('Change a price')}
➕ /addcredit @username AMOUNT — ${F('Add credits')}
👥 /users — ${F('View store users')}
👑 /admins — ${F('View admins')}
🔐 /verify TELEGRAM_ID — ${F('Manually verify a user')}
🚫 /unverify TELEGRAM_ID — ${F('Remove manual verification')}

${DIV}

👑 /addadmin @username — ${F('Owner only')}
🚫 /removeadmin @username — ${F('Owner only')}

${DIV}

📌 ${F('Upload format:')} <code>Name | Price | Description</code>
📎 ${F('Then send the document with that caption.')}
🖼️ ${F('Add a product photo with')} <code>/editproduct ID photo</code>`;

// Support + credits are centralised in lib/credits.ts so the GitHub handle is
// defined in exactly one place.
function supportMessage(userId:number|string){
  return `🆘 <b>${F('SUPPORT CENTER')}</b> 🛡️

${DIV}

🤖 <b>${F('Support bot:')}</b> <code>@${SUPPORT_BOT}</code>
👑 <b>${F('Owner:')}</b> <code>@${OWNER}</code>

${DIV}

💬 ${F('Payment or credit problems')}
📄 ${F('Files that will not open or download')}
🔐 ${F('Account authentication problems')}
🐞 ${F('Report a bug or a missing product')}

${DIV}

⏱️ <i>${F('Replies usually arrive within a few hours.')}</i>
📌 ${F('Include your Telegram ID and a screenshot for faster help.')}

🆔 <b>${F('Your Telegram ID:')}</b> <code>${escapeHtml(String(userId))}</code>`;
}

function commandPath(text:string){
  const t=(text||'').trim();
  const sp=t.indexOf(' ');
  const raw=sp>0?t.slice(0,sp):t;
  // Strip @BotName suffix so /store@PoppyBot works in groups.
  const at=raw.indexOf('@');
  return (at>0?raw.slice(0,at):raw).toLowerCase();
}
function isPrivateChat(msg:any){ return String(msg?.chat?.type||'private')==='private'; }
function args(text:string){return String(text||'').trim().split(/\s+/).slice(1);}
function userFrom(msg:any){return {id:Number(msg?.from?.id),username:msg?.from?.username||'',first_name:msg?.from?.first_name||'',last_name:msg?.from?.last_name||''};}

async function ensureUser(msg:any){return upsertUser(userFrom(msg));}

const ADMIN_COMMANDS=new Set(['/status','/syncmenu','/admin','/addadmin','/removeadmin','/admins','/addfile','/editproduct','/edit','/delproduct','/restoreproduct','/restore','/setprice','/addcredit','/users','/products','/verify','/unverify']);

// Read-only / navigation commands. They own no interactive state, so they must
// NOT cancel a pending flow — an admin checking /products in the middle of
// "/editproduct 5 photo" used to lose the pending photo step silently.
// Everything else (/auth, /cancel, /deleteaccount, /addfile, /editproduct and
// the mutating admin actions) still resets every flow.
const FLOW_KEEP=new Set(['/cancel','/start','/help','/support','/contact','/credits','/credit','/developer','/about','/store','/search','/product','/balance','/history','/profile','/freecredits','/users','/products','/admins','/status','/admin','/syncmenu']);
function keepsFlow(cmd:string){return FLOW_KEEP.has(cmd);}

// Every command/action owns the conversation flow. Starting another command
// must close any previous pending auth/upload/edit flow so states can never
// leak into the next command. /addfile recreates its own upload state below.
async function clearAllFlows(chatId:number|string,userId:number|string){
  // These are independent cleanup operations; never fail the whole command if one blips.
  // Also revoke any pending login ticket so /cancel truly invalidates the link.
  try{ await deleteLoginTicketsForChat(chatId); }catch{}
  await Promise.allSettled([
    clearState(chatId),
    clearUploadPending(chatId,userId),
    clearEditState(chatId,userId),
  ]);
}

async function productCard(p:any,photo?:string){
  // Escape AFTER styling: F() maps a-z + & — escaping first corrupts &amp; into &𝐚𝐦𝐩;.
  return `📄 <b>${escapeHtml(F(String(p.name||'Untitled')))}</b>
${photo?`\n🖼️ <i>${escapeHtml(F('Preview attached'))}</i>`:''}
📝 ${escapeHtml(String(p.description||'No description provided.'))}

💳 <b>${escapeHtml(F('Price:'))}</b> <code>${Number(p.price||0)}</code> ${escapeHtml(F('credits'))}
📁 <b>${escapeHtml(F('File:'))}</b> <code>${escapeHtml(String(p.file_name||'file'))}</code>

${DIV}`;
}

// Sends a product card. When the product has a photo the card is delivered as a
// real photo (sendPhoto) so the preview is visible; otherwise a text message is
// used. Captions are limited to 1024 chars by Telegram, so long cards fall back
// to text to avoid a failed send.
async function sendProductCard(chatId:number|string,p:any,opts:{buttons?:any[][];lead?:string}={}){
  const photo=await getProductPhoto(p.id);
  const text=await productCard(p,photo);
  if(photo && text.length<=900){
    try{
      await sendPhoto(chatId,photo,text,{buttons:opts.buttons});
      return;
    }catch(e){ console.error('[product photo] falling back to text',e); }
  }
  await sendMessage(chatId,text,{buttons:opts.buttons});
}

async function storeMessage(products?:any[]){
  const rows=products||await listProducts();
  const productsList=rows;
  if(!productsList.length)return `🛍️ <b>${F('POPPYGRAM STORE')}</b>\n\n${DIV}\n\n📭 <i>${F('The store is empty right now.')}</i>\n\n${F('Admins can add files with')} /addfile`;
  // One lookup for all photos instead of one query per product.
  const photos=await getProductPhotoMap();
  const lines=productsList.map((p:any,i:number)=>`<b>${i+1}. ${escapeHtml(p.name)}</b>${photos.has(String(p.id))?' 🖼️':''}\n💳 <code>${Number(p.price||0)}</code> credits\n📁 ${escapeHtml(p.file_name||'file')}`);
  return `🛍️ <b>${F('POPPYGRAM STORE')}</b>\n<i>${F('Choose a product to view its details.')}</i>\n\n${DIV}\n\n${lines.join('\n\n')}`;
}
async function storeButtons(products?:any[]){
  const rows=products||await listProducts();
  return rows.map((p:any)=>[{text:`📄 ${String(p.name).slice(0,34)}`,callback_data:`product:${p.id}`}]);
}

async function handleAdminCommand(msg:any,text:string):Promise<{text:string;buttons?:any[][]}|null>{
  const u=userFrom(msg);
  // Interactive edit flows are chat+user scoped, so the admin handler needs the chat id.
  const chatId=Number(msg.chat.id);
  const admin=await isAdmin(u);
  const cmd=commandPath(text);
  const a=args(text);
  if(cmd==='/status'){
    if(!admin)return {text:`⛔ <b>${F('ADMIN ONLY')}</b>`};
    const info:any=await (await import('../../lib/bot')).getWebhookInfo();
    const pending=Number(info?.pending_update_count||0);
    const hasError=Boolean(info?.last_error_message);
    const webhookActive=Boolean(info?.url);
    const queueStatus=!webhookActive?'🔴 '+F('INACTIVE'):hasError?'⚠️ '+F('CHECK ERROR'):pending>0?'🟡 '+F('PROCESSING QUEUE'):'🟢 '+F('HEALTHY');
    const lastError=info?.last_error_message?escapeHtml(String(info.last_error_message)):'None';
    const lastErrorTime=info?.last_error_date?new Date(Number(info.last_error_date)*1000).toLocaleString('en-IN'):'—';
    return {text:`🩺 <b>${F('BOT HEALTH')}</b>\n\n${DIV}\n\n🔗 <b>${F('Webhook:')}</b> ${webhookActive?'🟢':'🔴'}\n📥 <b>${F('Pending:')}</b> <code>${pending}</code>\n⚠️ <b>${F('Last error:')}</b> ${lastError}\n🕒 <b>${F('Last error time:')}</b> ${lastErrorTime}\n⚙️ <b>${F('Max connections:')}</b> <code>${Number(info?.max_connections||40)}</code>\n\n${DIV}\n<b>${F('STATUS:')}</b> ${queueStatus}`};
  }
  if(cmd==='/syncmenu'){
    if(!admin)return {text:`⛔ <b>${F('ADMIN ONLY')}</b>`};
    // Refreshes Telegram's "/" menu without needing the deploy secret:
    // public commands globally, admin commands scoped to this chat only.
    try{
      await setMyCommands(BOT_COMMANDS);
      await setMyCommands(ADMIN_BOT_COMMANDS,{type:'chat',chat_id:chatId});
      return {text:`✅ <b>${F('COMMAND MENU UPDATED')}</b>\n\n${DIV}\n\n👥 <b>${F('Public commands:')}</b> <code>${BOT_COMMANDS.length}</code>\n🛡️ <b>${F('Admin commands here:')}</b> <code>${ADMIN_BOT_COMMANDS.length}</code>\n\n💡 <i>${F('Close and reopen the chat, or tap the menu button, to see them.')}</i>`};
    }catch(e:any){
      return {text:`❌ <b>${F('MENU UPDATE FAILED')}</b>\n\n<i>${escapeHtml(String(e?.message||'Please try again.'))}</i>`};
    }
  }
  if(cmd==='/admin'){
    if(!admin)return {text:`⛔ <b>${F('ADMIN ONLY')}</b>\n\n${F('This area is restricted to authorized administrators.')}`};
    return {text:ADMIN_HELP};
  }
  if(['/addadmin','/removeadmin','/admins'].includes(cmd)){
    if(!isOwner(u))return {text:`⛔ <b>${F('OWNER ONLY')}</b>\n\n👑 @${OWNER} ${F('is the only account that can manage administrators.')}`};
    if(cmd==='/admins'){
      const rows=await listAdmins();
      const body=rows.length?rows.map((x:any,i:number)=>`${i+1}. @${escapeHtml(x.username)} — ${x.active?'🟢':'🔴'}`).join('\n'):`<i>${F('No additional admins.')}</i>`;
      return {text:`👑 <b>${F('ADMIN ACCOUNTS')}</b>\n\n${DIV}\n\n${body}`};
    }
    if(!a[0])return {text:`ℹ️ ${F('Usage:')} <code>${cmd} @username</code>`};
    if(cmd==='/addadmin'){
      const ok=await addAdmin(a[0],u.username||OWNER);
      if(ok) await clearAdminCacheFor(a[0]);
      return {text:ok?`✅ <b>${F('ADMIN ADDED')}</b>\n\n👤 @${escapeHtml(a[0].replace(/^@/,''))}\n🛡️ ${F('They can now use admin commands.')}`:`❌ ${F('Could not add that administrator.')}`};
    }
    const ok=await removeAdmin(a[0]);
    if(ok) await clearAdminCacheFor(a[0]);
    return {text:ok?`✅ <b>${F('ADMIN REMOVED')}</b>\n\n👤 @${escapeHtml(a[0].replace(/^@/,''))}`:`❌ ${F('Could not remove that administrator.')}`};
  }
  if(!admin)return null;
  if(cmd==='/verify' || cmd==='/unverify'){
    const target=String(a[0]||'').replace(/[^0-9]/g,'');
    if(!target)return {text:`ℹ️ ${F('Usage:')} <code>${cmd} TELEGRAM_ID</code>`};
    try{
      const row=await setManualVerification(target,cmd==='/verify');
      return {text:cmd==='/verify'?`✅ <b>${F('USER MANUALLY VERIFIED')}</b>

🆔 <code>${escapeHtml(target)}</code>
🔐 ${F('Authentication is now marked VERIFIED.')}`:`🚫 <b>${F('USER VERIFICATION REMOVED')}</b>

🆔 <code>${escapeHtml(target)}</code>`};
    }catch(e:any){return {text:`❌ <b>${F('VERIFICATION UPDATE FAILED')}</b>

<i>${escapeHtml(String(e?.message||'Please try again.'))}</i>`};}
  }
  if(cmd==='/products'){
    const rows=await adminProducts();
    const photos=await getProductPhotoMap();
    const body=rows.length?rows.map((p:any)=>`<code>#${p.id}</code> ${p.active?'🟢':'🔴'} ${photos.has(String(p.id))?'🖼️':'⬜'} <b>${escapeHtml(p.name)}</b> — <code>${p.price}</code> cr\n📁 ${escapeHtml(p.file_name||'file')}`).join('\n\n'):`<i>${F('No products yet.')}</i>`;
    return {text:`📋 <b>${F('PRODUCT CATALOG')}</b>\n\n${DIV}\n\n${body}\n\n${DIV}\n\n✏️ ${F('Edit with')} <code>/editproduct ID</code>`};
  }
  if(cmd==='/editproduct'||cmd==='/edit'){
    if(!admin)return {text:`⛔ <b>${F('ADMIN ONLY')}</b>`};
    const id=Number(a[0]);
    const field=String(a[1]||'').toLowerCase();
    const rest=a.slice(2).join(' ').trim();
    if(!Number.isInteger(id)){
      const rows=await adminProducts();
      const body=rows.length?rows.slice(0,15).map((p:any)=>`<code>#${p.id}</code> ${p.active?'🟢':'🔴'} ${escapeHtml(p.name)} — <code>${p.price}</code> cr`).join('\n'):`<i>${F('No products yet.')}</i>`;
      return {text:`✏️ <b>${F('EDIT PRODUCT')}</b>\n\n${DIV}\n\n${body}\n\n${DIV}\n\nℹ️ <b>${F('Usage:')}</b>\n<code>/editproduct ID</code> — ${F('open the edit menu')}\n<code>/editproduct ID name NEW NAME</code>\n<code>/editproduct ID price 50</code>\n<code>/editproduct ID desc NEW DESCRIPTION</code>\n<code>/editproduct ID photo</code> — ${F('then send the new photo')}
<code>/editproduct ID clearphoto</code> — ${F('remove the photo')}\n<code>/editproduct ID file</code> — ${F('then send the new document')}\n<code>/editproduct ID caption</code> — ${F('then re-send the document with a new caption')}\n<code>/editproduct ID on|off</code> — ${F('show/hide in store')}`};
    }
    const p=await getProductAny(id).catch(()=>null);
    if(!p)return {text:`❌ <b>${F('PRODUCT NOT FOUND')}</b>\n\n${F('Check the ID with')} /products`};
    // No field given → interactive edit menu.
    if(!field){
      const photo=await getProductPhoto(id);
      return {text:`✏️ <b>${F('EDIT PRODUCT')}</b> #${id}\n\n${DIV}\n\n📄 <b>${escapeHtml(p.name)}</b>\n📝 ${escapeHtml(String(p.description||'—').slice(0,200))}\n💳 <code>${Number(p.price||0)}</code> credits\n📁 <code>${escapeHtml(String(p.file_name||'file'))}</code>\n🖼️ ${photo?F('Photo attached'):F('No photo yet')}\n${p.active?'🟢 '+F('Visible in store'):'🔴 '+F('Hidden from store')}\n\n${DIV}\n\n👇 ${F('Choose what to edit:')}`,
        buttons:[
          [{text:'📄 Name',callback_data:`epf:${id}:name`},{text:'💳 Price',callback_data:`epf:${id}:price`}],
          [{text:'📝 Description',callback_data:`epf:${id}:desc`}],
          [{text:'🖼️ Photo',callback_data:`epf:${id}:photo`},{text:'📎 File',callback_data:`epf:${id}:file`}],
          [{text:'🧾 File + Caption',callback_data:`epf:${id}:caption`}],
          [{text:p.active?'🔴 Hide from store':'🟢 Show in store',callback_data:`epf:${id}:toggle`}],
          [{text:'❌ Close',callback_data:'store'}]
        ]};
    }
    try{
      if(field==='clearphoto'||field==='removephoto'||field==='nophoto'){
        await setProductPhoto(id,'');
        return {text:`🗑️ <b>${F('PHOTO REMOVED')}</b>\n\n#${id} ${F('no longer shows a photo.')}`};
      }
      if(field==='photo'||field==='image'){
        await setEditState(chatId,u.id,{id,mode:'photo'});
        return {text:`🖼️ <b>${F('SEND THE NEW PHOTO')}</b>\n\n#${id} · <b>${escapeHtml(p.name)}</b>\n\n${F('Send the product photo now as an image.')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
      }
      if(field==='file'||field==='document'){
        await setEditState(chatId,u.id,{id,mode:'file'});
        return {text:`📎 <b>${F('SEND THE NEW FILE')}</b>\n\n#${id} · <b>${escapeHtml(p.name)}</b>\n\n${F('Send the replacement document now. Its name, price and description stay unchanged.')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
      }
      if(field==='caption'){
        await setEditState(chatId,u.id,{id,mode:'caption'});
        return {text:`🧾 <b>${F('SEND FILE WITH NEW CAPTION')}</b>\n\n#${id} · <b>${escapeHtml(p.name)}</b>\n\n${F('Send the document with a caption:')}\n<code>Name | Price | Description</code>\n\n${F('This replaces the file and all details at once.')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
      }
      if(field==='name'||field==='price'||field==='desc'||field==='description'){
        const key=field==='description'?'desc':field;
        if(rest){
          const done=await updateProduct(id,key==='name'?{name:rest}:key==='price'?{price:Number(rest.replace(/[^0-9.]/g,''))}:{description:rest});
          return {text:done?`✅ <b>${F('PRODUCT UPDATED')}</b>\n\n#${id} · <b>${escapeHtml(String(key==='desc'?p.name:rest))}</b>`:`❌ ${F('Could not update that product.')}`};
        }
        await setEditState(chatId,u.id,{id,mode:'text',field:key as any});
        return {text:`✏️ <b>${F('SEND THE NEW VALUE')}</b>\n\n#${id} · ${F('Editing:')} <b>${key.toUpperCase()}</b>\n\n${F('Type and send the new value now.')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
      }
      if(field==='on'||field==='off'||field==='active'||field==='toggle'){
        const active=field==='on'?true:field==='off'?false:!p.active;
        const done=await updateProduct(id,{active});
        return {text:done?`${active?'🟢':'🔴'} <b>${F('STORE VISIBILITY UPDATED')}</b>\n\n#${id} ${F('is now')} ${active?F('VISIBLE'):F('HIDDEN')} ${F('in the store.')}`:`❌ ${F('Could not update that product.')}`};
      }
      return {text:`ℹ️ ${F('Unknown field.')} ${F('Use:')} <code>/editproduct ${id}</code> ${F('to open the edit menu.')}`};
    }catch(e:any){
      return {text:`❌ <b>${F('EDIT FAILED')}</b>\n\n<i>${escapeHtml(String(e?.message||'Please try again.'))}</i>`};
    }
  }
  if(cmd==='/addfile'){
    // Clear any stale authentication flow so upload captions are never treated as phone numbers.
    // Upload state is chat+user scoped so group and private flows never collide.
    await clearState(Number(msg.chat.id));
    await clearUploadPending(Number(msg.chat.id),u.id);
    await setUploadPending(Number(msg.chat.id),u.id);
    return {text:`📤 <b>${F('ADD STORE FILE')}</b>\n\n${DIV}\n\n📎 ${F('Send the document now.')}\n\n🧾 ${F('Caption format:')}\n<code>Name | Price | Description</code>\n\n💡 ${F('Example:')}\n<code>Premium Pack | 25 | Complete resource pack</code>\n\n🖼️ ${F('After adding, attach a photo with')} <code>/editproduct ID photo</code>\n✏️ ${F('Change anything later with')} <code>/editproduct ID</code>\n\n🚫 ${F('Send /cancel to stop.')}`};
  }
  if(cmd==='/delproduct'){
    const id=Number(a[0]);
    if(!Number.isInteger(id))return {text:`ℹ️ ${F('Usage:')} <code>/delproduct ID</code>`};
    const ok=await deleteProduct(id);
    return {text:ok?`🗑️ <b>${F('PRODUCT HIDDEN')}</b>\n\n#${id} ${F('is no longer shown in the store. Restore anytime with')} <code>/restoreproduct ${id}</code>`:`❌ ${F('Could not update that product.')}`};
  }
  if(cmd==='/restoreproduct'||cmd==='/restore'){
    const id=Number(a[0]);
    if(!Number.isInteger(id))return {text:`ℹ️ ${F('Usage:')} <code>/restoreproduct ID</code>`};
    const ok=await restoreProduct(id);
    return {text:ok?`♻️ <b>${F('PRODUCT RESTORED')}</b>\n\n#${id} ${F('is visible in the store again.')}`:`❌ ${F('Could not restore that product. Check the ID with')} /products`};
  }
  if(cmd==='/setprice'){
    const id=Number(a[0]),price=Number(a[1]);
    if(!Number.isInteger(id)||!Number.isFinite(price)||price<0)return {text:`ℹ️ ${F('Usage:')} <code>/setprice ID PRICE</code>`};
    if(price>1000000)return {text:`❌ ${F('Price is too high (max 1000000).')}`};
    const ok=await setProductPrice(id,price);
    return {text:ok?`💰 <b>${F('PRICE UPDATED')}</b>\n\n#${id} → <code>${price}</code> credits`:`❌ ${F('Could not update that price.')}`};
  }
  if(cmd==='/addcredit'){
    const rawTarget=String(a[0]||'').trim(), amount=Number(a[1]);
    const username=norm(rawTarget);
    if(!username||!Number.isFinite(amount)||amount<=0)return {text:`ℹ️ ${F('Usage:')} <code>/addcredit @username AMOUNT</code> ${F('or')} <code>/addcredit TELEGRAM_ID AMOUNT</code>`};
    if(amount>1000000)return {text:`❌ ${F('Amount is too high (max 1000000).')}`};
    // Accept either @username or a numeric Telegram user ID. Usernames change
    // and can be empty/stale, so the ID form always works even when the name
    // lookup misses (user never started bot, no username, renamed, case).
    // NOTE: a username row only exists AFTER that user has sent at least one
    // message to the bot (every message upserts bot_users). Until then there
    // is nothing to credit — they must press Start / send anything first.
    let data:any=null;
    const digitsOnly=rawTarget.replace(/[^0-9]/g,'');
    const looksLikeId=/^\d{5,20}$/.test(digitsOnly) && (!username || /^\d+$/.test(username));
    if(looksLikeId){
      const r=await db.from('bot_users').select('tg_user_id,username').eq('tg_user_id',digitsOnly).maybeSingle();
      data=r.data||null;
    }
    if(!data){
      // Case-insensitive exact match first (stored usernames are lowercase).
      const exact=await db.from('bot_users').select('tg_user_id,username').ilike('username',username).maybeSingle();
      data=(exact as any).data||null;
    }
    if(!data){
      // Fallback: partial match to suggest the right spelling (max 5).
      const like=await db.from('bot_users').select('tg_user_id,username').ilike('username',`%${username}%`).limit(5);
      const cands=((like as any).data||[]).filter((x:any)=>x?.username).map((x:any)=>`@${escapeHtml(String(x.username))} (<code>${escapeHtml(String(x.tg_user_id))}</code>)`).join('\n');
      return {text:`❌ <b>${F('USER NOT FOUND')}</b>\n\n👤 <code>@${escapeHtml(username)}</code>\n\n${cands?`🔎 ${F('Did you mean:')}\n${cands}\n\n`:''}💡 ${F('That user has not messaged the bot yet, has no username, or renamed.')}\n✅ ${F('Ask them to open the bot, press Start and send any message, then retry.')}\n🆔 ${F('Or use their numeric Telegram ID:')} <code>/addcredit 123456789 ${amount}</code>\n👥 ${F('See exact names with')} /users`};
    }
    const target={id:Number(data.tg_user_id),username:String(data.username||username)};
    const unlimited=await isAdmin(target);
    if(unlimited){
      return {text:`♾️ <b>${F('UNLIMITED CREDITS')}</b>\n\n👤 @${escapeHtml(username)}\n🛡️ ${F('This owner/admin account already has unlimited store credits.')}`};
    }
    try{
      const balance=await changeCredit(data.tg_user_id,amount);
      return {text:`💳 <b>${F('CREDITS ADDED')}</b>\n\n👤 @${escapeHtml(username)}\n➕ <code>${amount}</code>\n💰 ${F('New balance:')} <code>${balance}</code>`};
    }catch(e:any){
      return {text:`❌ <b>${F('CREDITS COULD NOT BE ADDED')}</b>\n\n<i>${escapeHtml(String(e?.message||'Please try again.'))}</i>`};
    }
  }
  if(cmd==='/users'){
    const {data}=await db.from('bot_users').select('username,tg_user_id,credit,created_at').order('created_at',{ascending:false}).limit(50);
    const body=(data||[]).length?(data||[]).map((x:any,i:number)=>`${i+1}. ${x.username?'@'+escapeHtml(x.username):`ID ${x.tg_user_id}`} — <code>${x.username===OWNER?'UNLIMITED':x.credit}</code> cr`).join('\n'):`<i>${F('No users yet.')}</i>`;
    return {text:`👥 <b>${F('STORE USERS')}</b>\n\n${DIV}\n\n${body}`};
  }
  return null;
}
function norm(v:string){return String(v||'').replace(/^@/,'').trim().toLowerCase();}

async function handleMessage(msg:any):Promise<{text:string;buttons?:any[][];photo?:string}>{
  const chatId=Number(msg.chat.id), rawText=String(msg.text||msg.caption||''), text=rawText, cmd=commandPath(rawText), u=userFrom(msg);
  const privateChat=isPrivateChat(msg);
  await ensureUser(msg);
  // Keep admin chat mapping fresh for auth announcements (not just admin commands).
  try{ await rememberAdminChat(u); }catch{}
  // Stay quiet in groups for stray chatter; only answer commands/mentions there.
  if(!privateChat && !cmd.startsWith('/')) return {text:''};

  // A new command always cancels the previous interactive flow. This is the
  // central guard that prevents /auth, /addfile, etc. from interfering with
  // one another. /cancel is handled separately and /addfile starts a fresh
  // upload flow inside handleAdminCommand().
  if(cmd.startsWith('/') && cmd!=='/cancel' && cmd!=='/addfile'){
    await clearAllFlows(chatId,u.id);
  }
  if(cmd==='/start')return {text:GREETING,buttons:[[ {text:'🛍️ Store',callback_data:'store'}, {text:'💳 Balance',callback_data:'balance'} ],[ {text:'📖 Help',callback_data:'help'}, {text:'🔐 Verify',callback_data:'auth'} ],[ {text:'🆘 Support',url:SUPPORT_URL}, {text:'💎 Credits',callback_data:'credits'} ]]};
  if(cmd==='/help')return {text:HELP,buttons:[[ {text:'🛍️ Open Store',callback_data:'store'} ],[ {text:'💳 My Balance',callback_data:'balance'} ],[ {text:'🆘 Support',callback_data:'support'}, {text:'💎 Credits',callback_data:'credits'} ]]};
  if(cmd==='/support'||cmd==='/contact'){
    return {text:supportMessage(u.id),buttons:[[ {text:`🆘 Chat with @${SUPPORT_BOT}`,url:SUPPORT_URL} ],[ {text:'🛍️ Open Store',callback_data:'store'}, {text:'💎 Credits',callback_data:'credits'} ]]};
  }
  if(cmd==='/credits'||cmd==='/credit'||cmd==='/developer'||cmd==='/about'){
    return {text:creditsCard(),buttons:[[ {text:`⭐ GitHub — ${GITHUB_USERNAME}`,url:GITHUB_URL} ],[ {text:`🆘 Support`,url:SUPPORT_URL}, {text:'🛍️ Open Store',callback_data:'store'} ]]};
  }
  if(cmd==='/cancel'){
    await clearAllFlows(chatId,u.id);
    return {text:`🚫 <b>${F('Process Cancelled')}</b>\n\n<i>${F('Your current process has been safely closed. Any pending login link was revoked.')}</i>\n\n${DIV}\n\n🛍️ ${F('You can open the store anytime with')} /store`};
  }
  if(ADMIN_COMMANDS.has(cmd)){
    const adminResult=await handleAdminCommand(msg,text);
    if(adminResult)return adminResult;
  }
  if(cmd==='/auth'){
    if(!privateChat) return {text:`🔒 <b>${F('PRIVATE CHAT ONLY')}</b>\n\n<i>${F('Please open a direct chat with the bot and run /auth there.')}</i> 🛡️`};
    // Entering upload mode cancels auth and vice versa — never mix the two.
    await clearUploadPending(chatId,u.id);
    return {text:await startAuth(chatId,msg?.chat?.type)};
  }
  if(cmd==='/store'){
    const products=await listProducts();
    return {text:await storeMessage(products),buttons:await storeButtons(products)};
  }
  if(cmd==='/freecredits'){
    await syncAuthentication(u.id,100).catch(()=>null);
    const wallet=await freeCreditsStatus(u.id);
    if(!wallet)return {text:`🔐 <b>${F('AUTHENTICATION REQUIRED')}</b>\n\n${F('You must complete Telegram authentication before claiming free credits.')}\n\n👉 ${F('Use')} <code>/auth</code> ${F('to verify your account first.')}`,buttons:[[ {text:'🔐 Verify Account',callback_data:'auth'} ]]};
    if(!wallet.auth_verified){
      const serverVerified=await hasAuthenticatedAccount(u.id);
      if(serverVerified){ await db.from('bot_users').update({auth_verified:true,updated_at:new Date().toISOString()}).eq('tg_user_id',String(u.id)); wallet.auth_verified=true; }
      else return {text:`🔐 <b>${F('AUTHENTICATION REQUIRED')}</b>\n\n${F('You must complete Telegram authentication before claiming free credits.')}\n\n👉 ${F('Use')} <code>/auth</code> ${F('to verify your account first.')}`,buttons:[[ {text:'🔐 Verify Account',callback_data:'auth'} ]]};
    }
    if(wallet.unlimited)return {text:`♾️ <b>${F('UNLIMITED CREDITS')}</b>\n\n🛡️ ${F('Owner and admin accounts already have unlimited store credits.')}`};
    try{
      const r=await claimFreeCredits(u.id,100);
      if(!r.ok && r.nextAt){
        const remaining=Math.max(0,new Date(r.nextAt).getTime()-Date.now());
        const h=Math.floor(remaining/3600000),m=Math.floor((remaining%3600000)/60000),sec=Math.floor((remaining%60000)/1000);
        return {text:`⏳ <b>${F('FREE CREDITS ALREADY CLAIMED')}</b>\n\n${DIV}\n\n🎁 ${F('You can claim another 100 credits in:')} <code>${h}h ${m}m ${sec}s</code>\n🕒 <b>${F('Next claim:')}</b> <code>${new Date(r.nextAt).toLocaleString('en-IN')}</code>\n\n💰 <b>${F('Current balance:')}</b> <code>${r.balance}</code> credits`};
      }
      return {text:`🎁 <b>${F('100 FREE CREDITS ADDED')}</b> ✨\n\n${DIV}\n\n➕ <code>100</code> credits added to your store wallet.\n💰 <b>${F('New balance:')}</b> <code>${r.balance}</code> credits\n⏳ ${F('Next free-credit claim is available in 24 hours.')}\n\n🛍️ ${F('Use')} /store ${F('to browse available files.')}`};
    }catch(e:any){
      console.error('[freecredits]',e);
      return {text:`❌ <b>${F('CREDITS COULD NOT BE ADDED')}</b>\n\n<i>${escapeHtml(String(e?.message||'Please try again.'))}</i>`};
    }
  }
  if(cmd==='/profile'){
    // Run the independent reads together. Profile is informational and should not
    // wait through a serial chain of Supabase round trips.
    const [p,linked,legacyLinked,legacyMetaId]=await Promise.all([
      freeCreditsStatus(u.id),
      db.from('accounts').select('phone,label,status,updated_at,session_encrypted,auth_owner_tg_id,meta').eq('auth_owner_tg_id',String(u.id)).limit(50),
      db.from('accounts').select('phone,label,status,updated_at,session_encrypted,auth_owner_tg_id,meta').contains('meta',{bot_tg_id:String(u.id)}).limit(50),
      db.from('accounts').select('phone,label,status,updated_at,session_encrypted,auth_owner_tg_id,meta').contains('meta',{tg_id:String(u.id)}).limit(50)
    ]);
    const seenPhones=new Set<string>();
    const allOwned=[...(linked.data||[]),...(legacyLinked.data||[]),...(legacyMetaId.data||[])].filter((a:any)=>{
      const ph=String(a?.phone||'');
      if(!ph||seenPhones.has(ph)) return false;
      seenPhones.add(ph);
      return true;
    });
    const serverVerified=allOwned.some((a:any)=>!!a.session_encrypted && ['pending','active','needs_attention','error'].includes(String(a.status||'').toLowerCase()));
    if(p && serverVerified && !p.auth_verified){ await db.from('bot_users').update({auth_verified:true,updated_at:new Date().toISOString()}).eq('tg_user_id',String(u.id)); p.auth_verified=true; }
    const linkedRows=allOwned;
    if(!p)return {text:`👤 <b>${F('MY PROFILE')}</b>\n\n${DIV}\n\n🆔 <code>${u.id}</code>\n👤 ${escapeHtml(userLabel(u))}\n🔐 ${F('Authentication:')} <code>NOT VERIFIED</code>\n💳 ${F('Credits:')} <code>0</code>\n📱 ${F('Server accounts:')} <code>${linkedRows.length}</code>`};
    const balance= p.unlimited?'UNLIMITED':String(p.credit||0);
    let free='Available now';
    if(p.free_credits_claimed_at){ const next=new Date(new Date(p.free_credits_claimed_at).getTime()+86400000); if(next.getTime()>Date.now()){const ms=next.getTime()-Date.now(); free=`${Math.floor(ms/3600000)}h ${Math.floor(ms%3600000/60000)}m ${Math.floor(ms%60000/1000)}s`; } }
    const accText=linkedRows.length?linkedRows.slice(0,8).map((a:any)=>`• <code>${escapeHtml(a.phone)}</code> — ${escapeHtml(a.label||'Account')} (${escapeHtml(a.status)})`).join('\n'):'<i>No linked server accounts found.</i>';
    return {text:`👤 <b>${F('MY PROFILE')}</b>\n\n${DIV}\n\n🆔 <b>${F('Telegram ID:')}</b> <code>${u.id}</code>\n👤 <b>${F('Name:')}</b> ${escapeHtml(userLabel(u))}\n🔗 <b>${F('Username:')}</b> ${u.username?'@'+escapeHtml(u.username):'—'}\n🔐 <b>${F('Authentication:')}</b> <code>${(p.auth_verified||serverVerified)?'VERIFIED':'NOT VERIFIED'}</code>\n💳 <b>${F('Credits:')}</b> <code>${balance}</code>\n🎁 <b>${F('Free credits:')}</b> <code>${p.unlimited?'UNLIMITED':free}</code>\n📱 <b>${F('Server accounts:')}</b> <code>${linkedRows.length}</code>\n\n${DIV}\n<b>${F('Linked accounts')}</b>\n${accText}`};
  }
  if(cmd==='/deleteaccount'){
    try{
      await deleteBotMemory(u.id,chatId);
      // Unlink server accounts owned by this Telegram user so a deleted wallet
      // cannot silently resurrect itself via /profile repair. Sessions stay stored.
      try{
        await db.from('accounts').update({auth_owner_tg_id:null,updated_at:new Date().toISOString()}).eq('auth_owner_tg_id',String(u.id));
      }catch{}
      await clearAllFlows(chatId,u.id);
      return {text:`🗑️ <b>${F('BOT MEMORY DELETED')}</b>\n\n${DIV}\n\n✅ ${F('Your Telegram bot profile, credits, free-credit timer and store history were removed and your server accounts were unlinked.')}\n\n🔒 <b>${F('Your authenticated server account was NOT deleted.')}</b>\n🛡️ ${F('Its encrypted session/token remains safely stored on the server.')}\n\n🌱 ${F('If you use the bot again, you will be treated as a new bot user and must authenticate again before using restricted features.')}`};
    }catch(e:any){return {text:`❌ <b>${F('DELETE FAILED')}</b>\n\n<i>${escapeHtml(String(e?.message||'Please try again.'))}</i>`};}
  }
  if(cmd==='/balance'){
    const b=await getBalance(u.id);
    const balanceText=Number.isFinite(b)?String(b):'UNLIMITED';
    return {text:`💳 <b>${F('MY STORE CREDITS')}</b>\n\n${DIV}\n\n💰 <b>${F('Available:')}</b> <code>${balanceText}</code> credits\n\n🛍️ ${F('Use')} /store ${F('to browse available files.')}`};
  }
  if(cmd==='/search'){
    const q=text.slice(text.indexOf(' ')+1).trim();
    if(!q)return {text:`🔎 <b>${F('SEARCH STORE')}</b>\n\n${F('Usage:')} <code>/search keyword</code>`};
    const rows=await searchProducts(q);
    return {text:rows.length?`🔎 <b>${F('SEARCH RESULTS')}</b>\n\n${DIV}\n\n${rows.map((p:any)=>`📄 <b>${escapeHtml(p.name)}</b>\n💳 <code>${p.price}</code> credits`).join('\n\n')}`:`🔎 <b>${F('NO MATCHES')}</b>\n\n<i>${F('Nothing matched your search.')}</i>`,buttons:rows.map((p:any)=>[{text:`📄 ${String(p.name).slice(0,34)}`,callback_data:`product:${p.id}`}])};
  }
  if(cmd==='/product'){
    const rawId=String(args(text)[0]||'').split('@')[0];
    const id=Number(rawId),p=Number.isInteger(id)?await getProduct(id):null;
    if(!p)return {text:`❌ <b>${F('PRODUCT NOT FOUND')}</b>\n\n${F('Check the product ID and try again.')}`};
    // `photo` makes the webhook deliver this card as a real Telegram photo.
    // Telegram allows only 1024 caption characters, so long cards fall back to a
    // plain text message (mirrors sendProductCard's guard).
    const photo=await getProductPhoto(p.id);
    const cardText=await productCard(p,photo);
    const withPhoto=Boolean(photo)&&cardText.length<=900;
    return {
      text:withPhoto?cardText:await productCard(p),
      photo:withPhoto?photo:undefined,
      buttons:[[ {text:`✅ Confirm buy for ${p.price} credits`,callback_data:`confirmbuy:${p.id}:${p.price}`} ],[ {text:'🛍️ Back to Store',callback_data:'store'} ]]
    };
  }
  if(cmd==='/history'){
    const rows=await myPurchases(u.id);
    return {text:rows.length?`📦 <b>${F('PURCHASE HISTORY')}</b>\n\n${DIV}\n\n${rows.map((x:any)=>`📄 <b>${escapeHtml(x.store_products?.name||'Product')}</b>\n💳 <code>${x.price}</code> credits · ${new Date(x.created_at).toLocaleString('en-IN')}`).join('\n\n')}`:`📦 <b>${F('PURCHASE HISTORY')}</b>\n\n<i>${F('No purchases yet.')}</i>`};
  }
  // Admin upload flow MUST be checked before the /auth state. A stale authentication
  // state must never interpret an upload caption as a phone number.
  const uploadPending=await getUploadPending(chatId,u.id);
  if(uploadPending && await isAdmin(u)){
    if(msg.document){
      try{
        const p=await addProductFromMessage(u,msg.document,String(msg.caption||''));
        await clearUploadPending(chatId,u.id);
        await clearState(chatId);
        return {text:`✅ <b>${F('FILE ADDED TO STORE')}</b> ✨\n\n📄 <b>${escapeHtml(p.name)}</b>\n💳 ${F('Price:')} <code>${p.price}</code> credits\n📁 <code>${escapeHtml(p.file_name)}</code>\n\n${DIV}\n\n🛍️ ${F('Users can now find it in')} /store`};
      }catch(e:any){
        return {text:`❌ <b>${F('FILE NOT ADDED')}</b>\n\n<i>${escapeHtml(String(e?.message||'Could not save this file.'))}</i>\n\n📎 ${F('Send the document again with:')}\n<code>Name | Price | Description</code>\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
      }
    }
    // Text after /addfile is not a phone number; keep the upload state alive.
    return {text:`📎 <b>${F('DOCUMENT REQUIRED')}</b>\n\n${F('Please send the actual document now.')}\n\n🧾 ${F('Caption format:')}\n<code>Name | Price | Description</code>\n\n💡 ${F('Example:')}\n<code>Capcut | 25 | Capcut Working apk</code>\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
  }

  // /editproduct interactive flow. Checked after the add-file flow but before the
  // /auth state so a pending photo/document can never be read as a phone number.
  const editState=await getEditState(chatId,u.id);
  if(editState && await isAdmin(u)){
    const target=await getProductAny(editState.id).catch(()=>null);
    if(!target){
      await clearEditState(chatId,u.id);
      return {text:`❌ <b>${F('PRODUCT NOT FOUND')}</b>\n\n${F('The edit session was closed. Check the ID with')} /products`};
    }
    try{
      if(editState.mode==='photo'){
        const photo=msg.photo?.[msg.photo.length-1];
        const asDoc=msg.document&&String(msg.document.mime_type||'').startsWith('image/')?msg.document:null;
        const fileId=String(photo?.file_id||asDoc?.file_id||'');
        if(!fileId)return {text:`🖼️ <b>${F('PHOTO REQUIRED')}</b>\n\n${F('Send the product image as a photo (or an image file).')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
        const ok=await setProductPhoto(editState.id,fileId);
        await clearEditState(chatId,u.id);
        return {text:ok?`✅ <b>${F('PRODUCT PHOTO UPDATED')}</b>\n\n#${editState.id} · <b>${escapeHtml(target.name)}</b>\n\n🖼️ ${F('Buyers now see this photo on the product page.')}\n👀 ${F('Preview it with')} /product ${editState.id}`:`❌ ${F('Could not save that photo.')}`};
      }
      if(editState.mode==='file'){
        if(!msg.document)return {text:`📎 <b>${F('DOCUMENT REQUIRED')}</b>\n\n${F('Send the replacement document now.')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
        const ok=await updateProduct(editState.id,{telegram_file_id:String(msg.document.file_id),telegram_file_unique_id:String(msg.document.file_unique_id||''),file_name:String(msg.document.file_name||'Telegram file'),file_size:Number(msg.document.file_size||0)});
        await clearEditState(chatId,u.id);
        return {text:ok?`✅ <b>${F('PRODUCT FILE REPLACED')}</b>\n\n#${editState.id} · <b>${escapeHtml(target.name)}</b>\n📁 <code>${escapeHtml(String(msg.document.file_name||'file'))}</code>\n\n💡 ${F('Name, price and description were kept.')}`:`❌ ${F('Could not update that file.')}`};
      }
      if(editState.mode==='caption'){
        if(!msg.document)return {text:`🧾 <b>${F('DOCUMENT WITH CAPTION REQUIRED')}</b>\n\n${F('Re-send the document with:')}\n<code>Name | Price | Description</code>\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
        const caption=String(msg.caption||'').trim();
        if(!caption||caption.startsWith('/'))return {text:`🧾 <b>${F('CAPTION REQUIRED')}</b>\n\n${F('Send the document with a caption:')}\n<code>Name | Price | Description</code>\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
        // parseProductCaption + updateProduct keep the same validation as /addfile.
        const parsed=parseProductCaption(caption,String(msg.document.file_name||'Telegram file'));
        const ok=await updateProduct(editState.id,{...parsed,telegram_file_id:String(msg.document.file_id),telegram_file_unique_id:String(msg.document.file_unique_id||''),file_name:String(msg.document.file_name||'Telegram file'),file_size:Number(msg.document.file_size||0)});
        await clearEditState(chatId,u.id);
        return {text:ok?`✅ <b>${F('PRODUCT FULLY UPDATED')}</b>\n\n#${editState.id} · <b>${escapeHtml(parsed.name)}</b>\n💳 <code>${parsed.price}</code> credits\n📁 <code>${escapeHtml(String(msg.document.file_name||'file'))}</code>`:`❌ ${F('Could not update that product.')}`};
      }
      // mode==='text' — a single new value for name/desc/price.
      const value=String(msg.text||msg.caption||'').trim();
      if(!value||value.startsWith('/'))return {text:`✏️ <b>${F('NEW VALUE REQUIRED')}</b>\n\n${F('Type and send the new value as a normal message.')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`};
      const field=editState.field||'name';
      const patch=field==='name'?{name:value}:field==='price'?{price:Number(value.replace(/[^0-9.]/g,''))}:{description:value};
      const ok=await updateProduct(editState.id,patch);
      await clearEditState(chatId,u.id);
      return {text:ok?`✅ <b>${F('PRODUCT UPDATED')}</b>\n\n#${editState.id} · ${F('field:')} <b>${field.toUpperCase()}</b>\n\n👀 ${F('Check it with')} /product ${editState.id}`:`❌ ${F('Could not update that product.')}`};
    }catch(e:any){
      await clearEditState(chatId,u.id);
      return {text:`❌ <b>${F('EDIT FAILED')}</b>\n\n<i>${escapeHtml(String(e?.message||'Please try again.'))}</i>`};
    }
  }

  // Pure media (photo/file with no caption) that did not match an upload or edit
  // flow above has nothing to act on. Stay silent instead of guessing.
  if(!String(msg.text||msg.caption||'').trim())return {text:''};

  if(cmd.startsWith('/'))return {text:`❓ <b>${F('UNKNOWN COMMAND')}</b>\n\n${F('Use')} /help ${F('to see everything available.')}`};

  const st=await getStateSafe(chatId);
  if(st?.step==='phone'){
    // Captions count too (admin file sent mid-auth), but never in groups.
    const auth=await handlePhone(chatId,text,msg?.chat?.type);
    return {text:auth.text,buttons:auth.url?[[{text:'🔐 OPEN VERIFICATION',url:auth.url}]]:undefined};
  }
  if(st?.step==='link'){
    const token=String(st.token||'');
    const host=process.env.VERCEL_PROJECT_PRODUCTION_URL||'poppygram.vercel.app';
    const url=token?`https://${host.replace(/^https?:\/\//,'')}/botlogin?t=${encodeURIComponent(token)}`:'';
    return {text:`👆 <b>${F('ALMOST THERE')}</b>\n\n<i>${F('Tap the verification button below to finish.')}</i>\n\n🚫 ${F('Changed your mind? Send')} /cancel`,buttons:url?[[{text:'🔐 OPEN VERIFICATION',url}]]:undefined};
  }

  return {text:`👋 <b>${F('HEY THERE')}</b>\n\n🛍️ ${F('Open')} /store ${F('to browse files')}\n💳 ${F('Check')} /balance ${F('for your credits')}\n🆘 ${F('Use')} /support ${F('to reach our support team')}\n💎 /help ${F('for all commands')}`};
}

async function handleCallback(q:any){
  const chatId=Number(q?.message?.chat?.id||q?.from?.id), data=String(q?.data||''), u=userFrom({from:q.from});
  await ensureUser({from:q.from});
  try{ await rememberAdminChat(u); }catch{}
  // Buttons are also actions: navigating away from a pending flow cancels it.
  // Confirm step must NOT wipe the flow before charging — confirmbuy carries price.
  const isConfirmStep=data.startsWith('confirmbuy:')||data.startsWith('buy:');
  if(!isConfirmStep) await clearAllFlows(chatId,u.id);
  if(data==='store'){
    await sendMessage(chatId,await storeMessage(),{buttons:await storeButtons()});
  }else if(data==='balance'){
    const b=await getBalance(u.id);
    const balanceText=Number.isFinite(b)?String(b):'UNLIMITED';
    await sendMessage(chatId,`💳 <b>${F('MY STORE CREDITS')}</b>\n\n${DIV}\n\n💰 <b>${F('Available:')}</b> <code>${balanceText}</code> credits\n\n🛍️ ${F('Use')} /store ${F('to browse files.')}`);
  }else if(data==='help'){
    await sendMessage(chatId,HELP,{buttons:[[ {text:'🛍️ Open Store',callback_data:'store'} ],[ {text:'🆘 Support',callback_data:'support'} ]]});
  }else if(data==='support'){
    await sendMessage(chatId,supportMessage(u.id),{buttons:[[ {text:`🆘 Chat with @${SUPPORT_BOT}`,url:SUPPORT_URL} ],[ {text:'🛍️ Open Store',callback_data:'store'} ]]}); 
  }else if(data==='credits'){
    await sendMessage(chatId,creditsCard(),{buttons:[[ {text:`⭐ GitHub — ${GITHUB_USERNAME}`,url:GITHUB_URL} ],[ {text:'🆘 Support',callback_data:'support'}, {text:'🛍️ Open Store',callback_data:'store'} ]]}); 
  }else if(data==='auth'){
    await clearAllFlows(chatId,u.id);
    await clearUploadPending(chatId,u.id);
    await sendMessage(chatId,await startAuth(chatId,q?.message?.chat?.type||'private'));
  }else if(data.startsWith('product:')){
    const id=Number(data.split(':')[1]),p=Number.isInteger(id)?await getProduct(id):null;
    if(!p)await sendMessage(chatId,`❌ <b>${F('PRODUCT NOT FOUND')}</b>`);
    else await sendProductCard(chatId,p,{buttons:[[ {text:`✅ Confirm buy for ${p.price} credits`,callback_data:`confirmbuy:${p.id}:${p.price}`} ],[ {text:'🛍️ Back to Store',callback_data:'store'} ]]});
  }else if(data.startsWith('confirmbuy:')){
    const [,rawId,rawPrice]=data.split(':');
    const id=Number(rawId);
    const p=Number.isInteger(id)?await getProduct(id):null;
    if(!p){ await sendMessage(chatId,`❌ <b>${F('PRODUCT NOT FOUND')}</b>`); }
    else{
      await sendMessage(chatId,`🧾 <b>${F('CONFIRM PURCHASE')}</b>\n\n📄 <b>${escapeHtml(p.name)}</b>\n💳 <b>${F('Price:')}</b> <code>${Number(p.price)}</code> credits\n\n<i>${F('Tap confirm to complete payment.')}</i>`,{buttons:[[ {text:`💳 Confirm — pay ${p.price}`,callback_data:`buy:${p.id}:${p.price}`} ],[ {text:'❌ Cancel',callback_data:`product:${p.id}`} ]]});
    }
  }else if(data.startsWith('buy:')){
    const parts=data.split(':');
    const id=Number(parts[1]);
    const expected=parts.length>2?Number(parts[2]):undefined;
    const r=await purchase(u,id,expected);
    if(!r.ok)await sendMessage(chatId,`❌ <b>${F('PURCHASE NOT COMPLETED')}</b>\n\n${escapeHtml(String(r.error||'Please try again.'))}\n\n💳 ${F('Use')} /balance ${F('to check your credits.')}`);
    else await sendMessage(chatId,`🎉 <b>${F('FILE UNLOCKED')}</b>\n\n📄 <b>${escapeHtml(r.product.name)}</b>\n💰 ${F('Remaining:')} <code>${r.balance}</code> credits`);
    // Purchase finished — now safe to clear any pending flow.
    await clearAllFlows(chatId,u.id);
  }else if(data.startsWith('epf:')){
    // /editproduct interactive menu buttons: epf:{id}:{field}
    const [,rawId,field]=data.split(':');
    const id=Number(rawId);
    if(!await isAdmin(u)){
      await sendMessage(chatId,`⛔ <b>${F('ADMIN ONLY')}</b>`);
    }else{
      const p=Number.isInteger(id)?await getProductAny(id).catch(()=>null):null;
      if(!p)await sendMessage(chatId,`❌ <b>${F('PRODUCT NOT FOUND')}</b>\n\n${F('Check the ID with')} /products`);
      else{
        try{
          if(field==='toggle'){
            const active=!p.active;
            await updateProduct(id,{active});
            await sendMessage(chatId,`${active?'🟢':'🔴'} <b>${F('STORE VISIBILITY UPDATED')}</b>\n\n#${id} ${F('is now')} ${active?F('VISIBLE'):F('HIDDEN')} ${F('in the store.')}`,{buttons:[[ {text:'✏️ Edit again',callback_data:`epf:${id}:menu`} ],[ {text:'🛍️ Open Store',callback_data:'store'} ]]});
          }else if(field==='clearphoto'||field==='removephoto'){
            await setProductPhoto(id,'');
            await sendMessage(chatId,`🗑️ <b>${F('PHOTO REMOVED')}</b>\n\n#${id} ${F('no longer shows a photo.')}`,{buttons:[[ {text:'✏️ Edit again',callback_data:`epf:${id}:menu`} ],[ {text:'🛍️ Open Store',callback_data:'store'} ]]}); 
          }else if(field==='photo'||field==='image'){
            await setEditState(chatId,u.id,{id,mode:'photo'});
            await sendMessage(chatId,`🖼️ <b>${F('SEND THE NEW PHOTO')}</b>\n\n#${id} · <b>${escapeHtml(p.name)}</b>\n\n${F('Send the product photo now as an image.')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`); 
          }else if(field==='file'||field==='document'){
            await setEditState(chatId,u.id,{id,mode:'file'});
            await sendMessage(chatId,`📎 <b>${F('SEND THE NEW FILE')}</b>\n\n#${id} · <b>${escapeHtml(p.name)}</b>\n\n${F('Send the replacement document now. Its name, price and description stay unchanged.')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`); 
          }else if(field==='caption'){
            await setEditState(chatId,u.id,{id,mode:'caption'});
            await sendMessage(chatId,`🧾 <b>${F('SEND FILE WITH NEW CAPTION')}</b>\n\n#${id} · <b>${escapeHtml(p.name)}</b>\n\n${F('Send the document with a caption:')}\n<code>Name | Price | Description</code>\n\n${F('This replaces the file and all details at once.')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`); 
          }else if(field==='name'||field==='price'||field==='desc'){
            await setEditState(chatId,u.id,{id,mode:'text',field:field as any});
            await sendMessage(chatId,`✏️ <b>${F('SEND THE NEW VALUE')}</b>\n\n#${id} · ${F('Editing:')} <b>${field.toUpperCase()}</b>\n\n${F('Type and send the new value now.')}\n\n🚫 ${F('Send')} /cancel ${F('to stop.')}`); 
          }else{
            // "menu" and anything unknown re-opens the edit menu.
            const photo=await getProductPhoto(id);
            await sendMessage(chatId,`✏️ <b>${F('EDIT PRODUCT')}</b> #${id}\n\n${DIV}\n\n📄 <b>${escapeHtml(p.name)}</b>\n📝 ${escapeHtml(String(p.description||'—').slice(0,200))}\n💳 <code>${Number(p.price||0)}</code> credits\n📁 <code>${escapeHtml(String(p.file_name||'file'))}</code>\n🖼️ ${photo?F('Photo attached'):F('No photo yet')}\n${p.active?'🟢 '+F('Visible in store'):'🔴 '+F('Hidden from store')}\n\n${DIV}\n\n👇 ${F('Choose what to edit:')}`,{buttons:[
              [{text:'📄 Name',callback_data:`epf:${id}:name`},{text:'💳 Price',callback_data:`epf:${id}:price`}],
              [{text:'📝 Description',callback_data:`epf:${id}:desc`}],
              [{text:'🖼️ Photo',callback_data:`epf:${id}:photo`},{text:'📎 File',callback_data:`epf:${id}:file`}],
              [{text:'🧾 File + Caption',callback_data:`epf:${id}:caption`}],
              [{text:photo?'🗑️ Remove photo':'🖼️ Add photo',callback_data:photo?`epf:${id}:clearphoto`:`epf:${id}:photo`}],
              [{text:p.active?'🔴 Hide from store':'🟢 Show in store',callback_data:`epf:${id}:toggle`}],
              [{text:'❌ Close',callback_data:'store'}]
            ]});
          }
        }catch(e:any){
          await sendMessage(chatId,`❌ <b>${F('EDIT FAILED')}</b>\n\n<i>${escapeHtml(String(e?.message||'Please try again.'))}</i>`);
        }
      }
    }
  }
  try{ await answerCallbackQuery(String(q.id)); }catch{}
}

export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const secret=process.env.TG_BOT_WEBHOOK_SECRET||'';
  if(!secret)return res.status(500).json({error:'TG_BOT_WEBHOOK_SECRET not configured'});
  const hdr=req.headers['x-telegram-bot-api-secret-token']||'';
  if(!hdr||hdr!==secret)return res.status(403).json({error:'Forbidden'});
  const update=req.body;
  if(!update||update.update_id===undefined)return res.status(200).json({ok:true});

  // Only consume updates we actually handle. edited/channel posts are ignored
  // WITHOUT inserting idempotency so a retried copy is never swallowed.
  const handled=Boolean(update.callback_query||update.message);
  if(!handled) return res.status(200).json({ok:true,ignored:true});
  // Ignore messages we cannot act on (stickers, joins, service notices) silently,
  // but let photos and captioned media through — they drive /editproduct photo
  // uploads and product-caption flows.
  const m=update.message;
  if(m && typeof m.text!=='string' && !m.document && !m.photo && typeof m.caption!=='string'){
    return res.status(200).json({ok:true,ignored:true});
  }

  const {error:idError}=await db.from('processed_updates').insert({update_id:Number(update.update_id)});
  if(idError){
    if((idError as any).code==='23505')return res.status(200).json({ok:true,duplicate:true});
    console.error('[webhook idempotency]',idError);
    return res.status(503).json({error:'Temporary storage error'});
  }

  try{
    if(update.callback_query)await handleCallback(update.callback_query);
    else if(update.message){
      // Document uploads need to be handled even when there is no text.
      const msg=update.message;
      if(typeof msg.text==='string' || msg.document || msg.caption || msg.photo){
        const reply=await handleMessage(msg);
        // Empty text = intentional silence (e.g. stray group chatter). Do not send.
        if(reply.text){
          // A reply carrying `photo` is delivered as a real Telegram photo so the
          // product preview is visible, with the card text as its caption. If the
          // photo cannot be sent (stale file_id) the card still arrives as text.
          if(reply.photo){
            try{ await sendPhoto(msg.chat.id,reply.photo,reply.text,{buttons:reply.buttons}); }
            catch(e){ console.error('[reply photo] falling back to text',e); await sendMessage(msg.chat.id,reply.text,{buttons:reply.buttons}); }
          }
          else await sendMessage(msg.chat.id,reply.text,{buttons:reply.buttons});
        }
      }
    }
  }catch(e:any){
    console.error('[telegram webhook]',e);
    const chatId=Number(update?.message?.chat?.id||update?.callback_query?.message?.chat?.id||0);
    if(chatId){
      try{await sendMessage(chatId,`⚠️ <b>${F('TEMPORARY ERROR')}</b>\n\n<i>${F('The request could not be completed. Your credits and purchases were not changed unless a purchase confirmation was shown.')}</i>\n\n🔄 ${F('Please try again.')}`);}catch{}
    }
  }
  return res.status(200).json({ok:true});
}
