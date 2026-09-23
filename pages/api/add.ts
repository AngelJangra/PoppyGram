import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';
import {requireAdmin} from '../../lib/adminAuth';

const normalizePhone=(v:string)=>v.replace(/[\s()-]/g,'');
export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const phone=normalizePhone(String(req.body?.phone||'').trim());
  if(!/^\+?\d{7,15}$/.test(phone))return res.status(400).json({error:'Valid international phone required'});
  const {data:setting}=await db.from('settings').select('value').eq('key','ping_interval_minutes').maybeSingle();
  const mins=Math.max(5,Number(setting?.value)||60);
  const {error}=await db.from('accounts').upsert({phone,label:'',status:'pending',ping_enabled:true,failure_count:0,meta:{},ping_interval_minutes:mins,next_ping_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'phone'});
  if(error)return res.status(500).json({error:error.message});
  const {error:logError}=await db.from('audit_logs').insert({event:'account.created',message:`Account placeholder created: ${phone}`});
  if(logError)console.error('[audit]',logError);
  res.json({success:true,phone});
}
