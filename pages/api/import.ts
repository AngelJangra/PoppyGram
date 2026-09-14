import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';
import {requireAdmin} from '../../lib/adminAuth';
export const config={api:{bodyParser:{sizeLimit:'1mb'}}};
const phoneRx=/^\+?\d{7,15}$/;
const sessionRx=/^[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$/;
const normalizePhone=(v:string)=>v.replace(/[\s()-]/g,'');
export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const items=Array.isArray(req.body?.data)?req.body.data:req.body?.data?.accounts;
  if(!Array.isArray(items))return res.status(400).json({error:'Invalid backup format'});
  if(items.length>1000)return res.status(400).json({error:'Too many accounts in import (max 1000)'});
  let imported=0,skipped=0;
  for(const x of items){
    if(!x||typeof x!=='object'||typeof x.phone!=='string') {skipped++;continue;}
    const phone=normalizePhone(x.phone.trim());
    if(!phoneRx.test(phone)){skipped++;continue;}
    const {data:existing}=await db.from('accounts').select('phone').eq('phone',phone).maybeSingle();
    if(existing){skipped++;continue;}
    const meta=(x.meta&&typeof x.meta==='object'&&!Array.isArray(x.meta))?x.meta:{};
    const status=['pending','active','needs_attention','error'].includes(String(x.status))?String(x.status):'pending';
    const interval=Number(x.ping_interval_minutes);
    const failures=Number(x.failure_count);
    const encrypted=typeof x.session_encrypted==='string'&&x.session_encrypted?x.session_encrypted:null;
    if(encrypted&&!sessionRx.test(encrypted)){skipped++;continue;}
    const safe={phone,label:String(x.label||'').slice(0,200),meta,status,ping_enabled:x.ping_enabled!==false,last_ping:x.last_ping||null,next_ping_at:x.next_ping_at||new Date().toISOString(),ping_interval_minutes:Number.isInteger(interval)&&interval>=5&&interval<=10080?interval:60,failure_count:Number.isInteger(failures)&&failures>=0&&failures<=100?failures:0,session_encrypted:encrypted,hard_ping_at:x.hard_ping_at||null,previous_session_encrypted:typeof x.previous_session_encrypted==='string'&&x.previous_session_encrypted?x.previous_session_encrypted:null,updated_at:new Date().toISOString()};
    const {error}=await db.from('accounts').insert(safe);
    if(!error){
      if(safe.previous_session_encrypted){
        await db.from('account_session_backups').insert({phone,session_encrypted:safe.previous_session_encrypted,captured_at:safe.hard_ping_at||new Date().toISOString(),reason:'legacy_import',verified:true});
      }
      imported++;
    } else skipped++;
  }
  const {error:logError}=await db.from('audit_logs').insert({event:'backup.imported',message:`Imported ${imported} account(s), skipped ${skipped}`});
  if(logError)console.error('[audit]',logError);
  res.json({success:true,imported,skipped});
}
