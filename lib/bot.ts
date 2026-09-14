// Minimal Telegram Bot API client (native fetch, no extra dependency).
// The bot token is read from env TG_BOT_TOKEN (never hardcoded).

export function botToken(){return process.env.TG_BOT_TOKEN||'';}

// FIX #30: Add request timeout to prevent hanging on slow Telegram API calls.
export async function api<T=any>(method:string,params:any={}):Promise<T>{
  const t=botToken();
  if(!t)throw new Error('TG_BOT_TOKEN is not set');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  const r=await fetch(`https://api.telegram.org/bot${t}/${method}`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(params),
    signal:controller.signal,
  }).finally(()=>clearTimeout(timeout));
  const j=await r.json().catch(()=>({}));
  if(!j.ok)throw new Error(`${method}: ${(j.description||'unknown Telegram API error')}`);
  return j.result as T;
}

// Premium text helpers + rich formatting support for a luxury bot feel.
// F() converts plain ASCII into Mathematical Sans-Serif Bold unicode
// (𝗔𝗕𝗖 123) — renders as "premium font" on all Telegram clients with
// zero dependencies and no custom font files needed.
export function F(s:string):string{
  const out:string[]=[];
  for(const ch of String(s||'')){
    const c=ch.codePointAt(0)!;
    if(c>=0x41&&c<=0x5A)out.push(String.fromCodePoint(0x1D5A0+(c-0x41))); // A-Z
    else if(c>=0x61&&c<=0x7A)out.push(String.fromCodePoint(0x1D5BA+(c-0x61))); // a-z
    else if(c>=0x30&&c<=0x39)out.push(String.fromCodePoint(0x1D7EC+(c-0x30))); // 0-9
    else out.push(ch);
  }
  return out.join('');
}

export function escapeHtml(s:string):string{
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export interface BotButton{text:string;url?:string;callback_data?:string}
export async function sendMessage(chatId:number|string,text:string,opts?:{buttons?:BotButton[][];parse_mode?:'HTML';disablePreview?:boolean}){
  const params:any={chat_id:chatId,text,parse_mode:opts?.parse_mode||'HTML',disable_web_page_preview:opts?.disablePreview!==false};
  if(opts&&opts.buttons&&opts.buttons.length){
    params.reply_markup={inline_keyboard:opts.buttons.map(row=>row.map(b=>({text:b.text,url:b.url,callback_data:b.callback_data})))};
  }
  await api('sendMessage',params);
}
export async function getMe():Promise<any>{return api('getMe');}
export async function setWebhook(url:string,secretToken?:string){
  const params:any={url,allowed_updates:['message'],drop_pending_updates:true};
  if(secretToken)params.secret_token=secretToken;
  return api('setWebhook',params);
}
export async function getWebhookInfo():Promise<any>{return api('getWebhookInfo');}
export async function deleteWebhook(){return api('deleteWebhook');}