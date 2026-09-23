import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';
import {requireAdmin} from '../../lib/adminAuth';

export const config={api:{bodyParser:{sizeLimit:'1mb'}}};

export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(!requireAdmin(req,res))return;
  const limit=parseInt(String(req.query.limit||'500'));
  if(isNaN(limit)||limit<1||limit>1000)return res.status(400).json({error:'Invalid limit'});
  const {data,error}=await db.from('accounts').select('*').limit(limit);
  if(error)return res.status(500).json({error:error.message});
  await db.from('audit_logs').insert({event:'backup.export',message:`Exported ${data?.length||0} account(s) (limit=${limit})`});
  res.setHeader('Content-Type','application/json');
  res.setHeader('Content-Disposition','attachment; filename=poppygram-backup.json');
  res.json({version:2,created_at:new Date().toISOString(),warning:'Contains encrypted session material; store securely.',accountCount:data?.length||0,accounts:data||[]});
}