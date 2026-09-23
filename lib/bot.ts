// Minimal Telegram Bot API client (native fetch, no extra dependency).
// The bot token is read from env TG_BOT_TOKEN (never hardcoded).
import {withCredit,creditLine,CREDIT_MARK} from './credits';

export function botToken(){return process.env.TG_BOT_TOKEN||'';}

export async function api<T=any>(method:string,params:any={},retry=true):Promise<T>{
  const t=botToken();
  if(!t)throw new Error('TG_BOT_TOKEN is not set');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(`https://api.telegram.org/bot${t}/${method}`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(params),
      signal:controller.signal,
    });
    const j=await r.json().catch(()=>({}));
    if(!j.ok){
      const retryAfter=Number(j?.parameters?.retry_after||0);
      // Honor Telegram flood control once instead of failing silently.
      if(retry && retryAfter>0 && retryAfter<=60){
        await new Promise(res=>setTimeout(res,retryAfter*1000+200));
        return api<T>(method,params,false);
      }
      const err=new Error(`${method}: ${(j.description||'unknown Telegram API error')}`);
      (err as any).retryAfter=retryAfter;
      throw err;
    }
    return j.result as T;
  }finally{clearTimeout(timeout);}
}

export function F(s:string):string{
  const out:string[]=[];
  for(const ch of String(s||'')){
    const c=ch.codePointAt(0)!;
    if(c>=0x41&&c<=0x5A)out.push(String.fromCodePoint(0x1D5A0+(c-0x41)));
    else if(c>=0x61&&c<=0x7A)out.push(String.fromCodePoint(0x1D5BA+(c-0x61)));
    else if(c>=0x30&&c<=0x39)out.push(String.fromCodePoint(0x1D7EC+(c-0x30)));
    else out.push(ch);
  }
  return out.join('');
}
export function escapeHtml(s:string):string{
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
export interface BotButton{text:string;url?:string;callback_data?:string}
function keyboard(buttons?:BotButton[][]){
  if(!buttons?.length)return undefined;
  return {inline_keyboard:buttons.map(row=>row.map(b=>({text:b.text,...(b.url?{url:b.url}:{}),...(b.callback_data?{callback_data:b.callback_data}:{})})))};
}
// Every bot reply carries the author credit. Pass credit:false for internal
// transport messages that must stay clean.
export async function sendMessage(chatId:number|string,text:string,opts?:{buttons?:BotButton[][];parse_mode?:'HTML';disablePreview?:boolean;credit?:boolean}){
  const body=opts?.credit===false?String(text||''):withCredit(String(text||''));
  const params:any={chat_id:chatId,text:body,parse_mode:opts?.parse_mode||'HTML',disable_web_page_preview:opts?.disablePreview!==false};
  const markup=keyboard(opts?.buttons);
  if(markup)params.reply_markup=markup;
  await api('sendMessage',params);
}
// Telegram caps photo captions at 1024 characters (messages allow 4096), so the
// caption is trimmed defensively before sending. Photo captions carry a compact
// one-line credit so product photos are branded too.
export async function sendPhoto(chatId:number|string,fileId:string,caption?:string,opts?:{buttons?:BotButton[][];credit?:boolean}){
  const params:any={chat_id:chatId,photo:fileId,parse_mode:'HTML'};
  let cap=String(caption||'');
  if(cap && opts?.credit!==false && !cap.includes(CREDIT_MARK))cap=`${cap}\n\n${creditLine()}`;
  if(cap)params.caption=cap.length>1024?`${cap.slice(0,1020)}…`:cap;
  const markup=keyboard(opts?.buttons);
  if(markup)params.reply_markup=markup;
  return api('sendPhoto',params);
}
export async function answerCallbackQuery(id:string,text?:string,showAlert=false){
  return api('answerCallbackQuery',{callback_query_id:id,text,show_alert:showAlert});
}
export async function sendDocument(chatId:number|string,fileId:string,caption?:string){
  return api('sendDocument',{chat_id:chatId,document:fileId,caption,parse_mode:'HTML'});
}
// Commands shown in Telegram's "/" menu. Kept in one place so the webhook
// (/syncmenu, owner) and /api/bot-setup always register the identical list.
export const BOT_COMMANDS=[
  {command:'start',description:'Open PoppyGram'},
  {command:'store',description:'Browse the file store'},
  {command:'search',description:'Search store products'},
  {command:'product',description:'View a product'},
  {command:'balance',description:'Check store credits'},
  {command:'history',description:'View purchase history'},
  {command:'profile',description:'Your profile and account status'},
  {command:'auth',description:'Add your Telegram account'},
  {command:'freecredits',description:'Claim free store credits'},
  {command:'support',description:'Contact PoppyGram support'},
  {command:'credits',description:'Project credits and developer'},
  {command:'help',description:'Show all commands'}
];
// Extra commands only registered for an admin's own chat scope, so regular
// users never see the store-management menu.
export const ADMIN_BOT_COMMANDS=[
  {command:'admin',description:'Admin command list'},
  {command:'addfile',description:'Upload a store file'},
  {command:'editproduct',description:'Edit a product'},
  {command:'products',description:'List products'},
  {command:'delproduct',description:'Hide a product'},
  {command:'restoreproduct',description:'Restore a hidden product'},
  {command:'setprice',description:'Change a price'},
  {command:'addcredit',description:'Add user credits'},
  {command:'users',description:'List store users'},
  {command:'status',description:'Webhook health'},
  {command:'syncmenu',description:'Refresh the bot command menu'}
];
export async function setMyCommands(commands:{command:string;description:string}[],scope?:any){
  return api('setMyCommands',{commands,scope});
}
export async function getMe():Promise<any>{return api('getMe');}
export async function setWebhook(url:string,secretToken?:string,dropPending=false){
  const params:any={url,allowed_updates:['message','callback_query'],drop_pending_updates:dropPending};
  if(secretToken)params.secret_token=secretToken;
  return api('setWebhook',params);
}
export async function getWebhookInfo():Promise<any>{return api('getWebhookInfo');}
export async function deleteWebhook(){return api('deleteWebhook');}
