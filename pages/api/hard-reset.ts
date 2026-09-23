import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';
import {encrypt} from '../../lib/encryption';
import {requireAdmin} from '../../lib/adminAuth';

const normalizePhone=(v:string)=>v.replace(/[\s()-]/g,'');
const phoneRx=/^\+?\d{7,15}$/;
export const config={api:{bodyParser:{sizeLimit:'1mb'}}};

export default async function handler(req:NextApiRequest,res:NextApiResponse){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const phone=normalizePhone(String(req.body?.phone||'').trim());
  const session=String(req.body?.session||'');
  if(!phoneRx.test(phone))return res.status(400).json({error:'Valid international phone required'});
  // GramJS StringSession is an opaque serialized session, not a JWT.
  // Telegram's getMe() in the browser is the authoritative authentication check.
  if(!session||session.length>10000||/[\u0000-\u001F\u007F]/.test(session))return res.status(400).json({error:'Invalid Telegram session format'});
  const meta=req.body?.meta||{};
  const clean={first_name:String(meta.first_name||'').slice(0,100),last_name:String(meta.last_name||'').slice(0,100),username:String(meta.username||'').slice(0,100),tg_id:String(meta.tg_id||'').slice(0,100)};
  const {data:current,error:readError}=await db.from('accounts').select('session_encrypted').eq('phone',phone).single();
  if(readError||!current)return res.status(404).json({error:'Account not found'});
  if(!current.session_encrypted)return res.status(409).json({error:'No previous session exists for this account'});
  const now=new Date().toISOString();
  // Preserve the old encrypted session permanently before replacing it.
  const {error:backupError}=await db.from('account_session_backups').insert({
    phone,
    session_encrypted:current.session_encrypted,
    captured_at:now,
    reason:'hard_reset',
    verified:true
  });
  if(backupError)return res.status(500).json({error:'Could not create session backup; active session was not changed'});

  const {error}=await db.from('accounts').update({session_encrypted:encrypt(session),previous_session_encrypted:current.session_encrypted,hard_ping_at:now,status:'active',failure_count:0,last_ping:now,updated_at:now,meta:clean}).eq('phone',phone);
  if(error)return res.status(500).json({error:error.message});
  const {error:logError}=await db.from('audit_logs').insert({event:'account.hard_reset',message:`Hard reset completed for ${phone}; previous encrypted session appended to account_session_backups.`});
  if(logError)console.error('[audit]',logError);
  res.json({success:true,hard_ping_at:now});
}
