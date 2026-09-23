// Supports the hybrid bot login:
//  GET /api/bot-verify?t=<token>   -> validates the one-time ticket, returns {ok, phone}
//  POST /api/bot-verify {t, session, meta} -> stores the account permanently + replies in the bot chat
import type {NextApiRequest,NextApiResponse} from 'next';
import {getTicket,completeLogin} from '../../lib/botFlow';
import {botToken,getMe} from '../../lib/bot';

export default async function h(req:NextApiRequest,res:NextApiResponse){
  const t=String(req.method==='GET'?(req.query?.t||''):(req.body?.t||''));
  if(!t)return res.status(400).json({error:'Missing ticket'});

  if(req.method==='GET'){
    const ok=!!botToken();
    const ticket=await getTicket(t);
    if(!ticket)return res.status(404).json({error:'Invalid or expired link'});
    return res.json({ok,phone:ticket.phone});
  }

  if(req.method==='POST'){
    const session=String(req.body?.session||'');
    if(!session)return res.status(400).json({error:'Missing session'});
    const r=await completeLogin(t,session,req.body?.meta||{});
    if(!r.ok){
      if((r as any).error==='save_failed')return res.status(500).json({error:'Account save failed, please try again'});
      if((r as any).error==='wallet_sync_failed')return res.status(500).json({error:'Account was saved, but Telegram verification could not be linked. Please return to the bot and use /profile to repair the status.'});
      if((r as any).error==='phone_owned_by_other')return res.status(409).json({error:'This phone number is already linked to a different Telegram user. Ask an admin for help.'});
      if((r as any).error==='missing_tg_identity')return res.status(400).json({error:'Telegram identity missing. Please finish login in the browser and try again.'});
      return res.status(r.error==='invalid_payload'?400:409).json({error:r.error==='invalid_payload'?'Invalid login payload':'Invalid or expired link'});
    }
    return res.json({ok:true});
  }

  return res.status(405).json({error:'Method not allowed'});
}