import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../../lib/db';
import {isAdmin} from '../../../lib/adminAuth';

export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!isAdmin(req))return res.status(401).json({error:'Unauthorized'});
  const now=new Date().toISOString();
  const {error}=await db.from('settings').upsert({key:'admin_logout_before',value:now,updated_at:now},{onConflict:'key'});
  if(error)return res.status(500).json({error:'Could not sign out all users'});
  await db.from('audit_logs').insert({event:'auth.logout_all',message:'All admin sessions were invalidated'});
  const secure=req.headers['x-forwarded-proto']==='https'||process.env.NODE_ENV==='production';
  res.setHeader('Set-Cookie',`admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`);
  res.setHeader('Cache-Control','no-store');
  res.json({success:true});
}
