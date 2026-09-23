import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../../lib/db';
import {isAdmin,sessionExpiryMs,SESSION_TTL_MS} from '../../../lib/adminAuth';

export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const signed=isAdmin(req);
  let ok=signed;
  if(signed){
    const {data}=await db.from('settings').select('value').eq('key','admin_logout_before').maybeSingle();
    const revoked=Date.parse(String(data?.value||''));
    const issued=sessionExpiryMs(req)!-SESSION_TTL_MS;
    if(Number.isFinite(revoked)&&issued<=revoked)ok=false;
  }
  res.setHeader('Cache-Control','no-store');
  res.json({loggedIn:ok,expiresAt:ok?sessionExpiryMs(req):null});
}
