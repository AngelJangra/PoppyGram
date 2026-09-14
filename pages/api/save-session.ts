import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';
import {requireAdmin} from '../../lib/adminAuth';
import {encrypt} from '../../lib/encryption';
export const config={api:{bodyParser:{sizeLimit:'1mb'}}};
const normalizePhone=(v:string)=>v.replace(/[\s()-]/g,'');
export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const phone=normalizePhone(String(req.body?.phone||'').trim());
  const session=String(req.body?.session||'');
  if(!/^\+?\d{7,15}$/.test(phone))return res.status(400).json({error:'Valid international phone required'});
  if(!session||session.length>10000)return res.status(400).json({error:'Invalid session'});
  const meta=req.body?.meta||{};
  const clean={first_name:String(meta.first_name||meta.firstName||'').slice(0,100),last_name:String(meta.last_name||meta.lastName||'').slice(0,100),username:String(meta.username||'').slice(0,100),tg_id:String(meta.tg_id||meta.id||'').slice(0,100)};
  const {data:setting}=await db.from('settings').select('value').eq('key','ping_interval_minutes').maybeSingle();
  const mins=Math.max(5,Number(setting?.value)||60);
  const {error}=await db.from('accounts').upsert({phone,label:'',status:'active',ping_enabled:true,failure_count:0,meta:clean,ping_interval_minutes:mins,last_ping:new Date().toISOString(),next_ping_at:new Date(Date.now()+mins*60000).toISOString(),session_encrypted:encrypt(session),updated_at:new Date().toISOString()},{onConflict:'phone'});
  if(error)return res.status(500).json({error:error.message});
  const {error:logError}=await db.from('audit_logs').insert({event:'account.login',message:`Logged in and saved ${phone} (@${clean.username||'-'})`});
  if(logError)console.error('[audit]',logError);
  res.json({success:true,meta:clean});
}
