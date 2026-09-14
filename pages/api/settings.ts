import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';
import {requireAdmin} from '../../lib/adminAuth';

export const config={api:{bodyParser:{sizeLimit:'1mb'}}};

export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(!requireAdmin(req,res))return;
  if(req.method==='GET'){
    const {data,error}=await db.from('settings').select('key,value');
    if(error)return res.status(500).json({error:error.message});
    const settings=Object.fromEntries((data||[]).map((x:any)=>[x.key,x.value]));
    return res.json({settings});
  }
  if(req.method==='POST'){
    const s=req.body?.settings||{};
    // FIX #15: Validate input values before storing.
    const updates=[];
    if(s.site_name!==undefined){
      const name=String(s.site_name||'').trim();
      if(name.length>0&&name.length<=100)updates.push({key:'site_name',value:name});
      else return res.status(400).json({error:'site_name must be 1-100 characters'});
    }
    if(s.ping_interval_minutes!==undefined){
      const mins=Number(s.ping_interval_minutes);
      if(!Number.isInteger(mins)||mins<5||mins>10080)return res.status(400).json({error:'ping_interval_minutes must be an integer between 5 and 10080'});
      updates.push({key:'ping_interval_minutes',value:String(mins)});
    }
    if(s.max_attempts!==undefined){
      const max=Number(s.max_attempts);
      if(!Number.isInteger(max)||max<1||max>10)return res.status(400).json({error:'max_attempts must be an integer between 1 and 10'});
      updates.push({key:'max_attempts',value:String(max)});
    }
    for(const u of updates){const {error}=await db.from('settings').upsert({key:u.key,value:u.value,updated_at:new Date().toISOString()},{onConflict:'key'});if(error)return res.status(500).json({error:error.message});}
    await db.from('audit_logs').insert({event:'settings.updated',message:'Settings updated'});
    return res.json({success:true});
  }
  res.status(405).json({error:'Method not allowed'});
}