import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';
import {requireAdmin} from '../../lib/adminAuth';
import {decrypt} from '../../lib/encryption';

export const config={api:{bodyParser:{sizeLimit:'1mb'}}};

export default async function handler(req:NextApiRequest,res:NextApiResponse){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const phone=String(req.body?.phone||'');
  if(!phone)return res.status(400).json({error:'Phone required'});
  const {data,error}=await db.from('accounts').select('session_encrypted').eq('phone',phone).single();
  if(error||!data)return res.status(404).json({error:'Account not found'});
  if(!data.session_encrypted)return res.status(400).json({error:'No session stored — re-login required'});
  try{
    const session=decrypt(data.session_encrypted);
    // FIX #19: Audit log sensitive session access.
    await db.from('audit_logs').insert({event:'session.accessed',message:`Session accessed for ${phone}`});
    res.json({session});
  }catch{
    res.status(500).json({error:'Failed to decrypt session'});
  }
}