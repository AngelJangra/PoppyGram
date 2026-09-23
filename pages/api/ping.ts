import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';
import {requireAdmin} from '../../lib/adminAuth';

// Records the result of a browser-side MTProto ping. The server never connects to Telegram.
export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const phone=String(req.body?.phone||'').trim().replace(/[\s()-]/g,'');
  const success=req.body?.success===true;
  const errorMessage=String(req.body?.error||'').slice(0,300);
  if(!phone)return res.status(400).json({error:'Phone required'});
  const now=new Date();
  if(success){
    const {data}=await db.from('accounts').select('ping_interval_minutes').eq('phone',phone).maybeSingle();
    const mins=Math.max(5,Number(data?.ping_interval_minutes)||60);
    const {error}=await db.from('accounts').update({status:'active',last_ping:now.toISOString(),next_ping_at:new Date(now.getTime()+mins*60000).toISOString(),failure_count:0,updated_at:now.toISOString()}).eq('phone',phone);
    if(error)return res.status(500).json({error:error.message});
    const {error:logError}=await db.from('audit_logs').insert({event:'ping.success',message:`Browser ping succeeded for ${phone}`}); if(logError)console.error('[audit]',logError);
    return res.json({success:true});
  }
  const {data}=await db.from('accounts').select('failure_count').eq('phone',phone).maybeSingle();
  const failures=(Number(data?.failure_count)||0)+1;
  const maxRow=await db.from('settings').select('value').eq('key','max_attempts').maybeSingle();
  const maxAttempts=Math.max(1,Number(maxRow.data?.value)||3);
  const fields:any={status:failures>=maxAttempts?'error':'needs_attention',failure_count:failures,next_ping_at:new Date(now.getTime()+Math.min(60,5*failures)*60000).toISOString(),updated_at:now.toISOString()};
  if(failures>=maxAttempts)fields.ping_enabled=false;
  const {error}=await db.from('accounts').update(fields).eq('phone',phone);
  if(error)return res.status(500).json({error:error.message});
  const {error:logError}=await db.from('audit_logs').insert({event:'ping.failed',message:`Browser ping failed for ${phone}: ${errorMessage||'unknown error'}`}); if(logError)console.error('[audit]',logError);
  return res.json({success:false});
}
