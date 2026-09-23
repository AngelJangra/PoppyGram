import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';

// Vercel cannot run MTProto reliably. This endpoint only reports which accounts
// are due; the browser performs the actual Telegram checks and posts results to /api/ping.
export default async function h(req:NextApiRequest,res:NextApiResponse){
  const auth=req.headers.authorization?.replace(/^Bearer\s+/i,'')||'';
  const manual=req.query.manual==='true'||req.body?.manual===true;
  const adminManual=manual;
  if(!adminManual && (!process.env.CRON_SECRET || auth!==process.env.CRON_SECRET))return res.status(401).json({error:'Unauthorized'});
  const {data,error}=await db.from('accounts').select('phone,next_ping_at,ping_enabled').eq('ping_enabled',true).lte('next_ping_at',new Date().toISOString()).limit(100);
  if(error)return res.status(500).json({error:error.message});
  const {error:logError}=await db.from('audit_logs').insert({event:'scheduler.run',message:`Found ${data?.length||0} due account(s); Telegram checks must run in an open browser.`}); if(logError)console.error('[audit]',logError);
  res.json({processed:0,due:data||[],mode:'browser-only'});
}
