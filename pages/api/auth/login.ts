import type {NextApiRequest,NextApiResponse} from 'next';import {verifyPassword,signSession,SESSION_TTL_MS} from '../../../lib/adminAuth';// FIX #13: Add simple in-memory rate limiter to prevent brute-force attacks.
const attemptTracker:Map<string,{count:number;first:number}>=new Map();
const MAX_ATTEMPTS=5;
const WINDOW_MS=5*60*1000; // 5 minutes

function isRateLimited(ip:string):boolean{
  const now=Date.now();
  // Prune stale records: without this the map grows for the lifetime of a warm
  // serverless instance (one entry per attacking IP).
  if(attemptTracker.size>500){
    for(const [key,value] of attemptTracker){if(now-value.first>WINDOW_MS)attemptTracker.delete(key);}
  }
  const rec=attemptTracker.get(ip);
  if(!rec){attemptTracker.set(ip,{count:1,first:now});return false;}
  if(now-rec.first>WINDOW_MS){attemptTracker.set(ip,{count:1,first:now});return false;}
  if(rec.count>=MAX_ATTEMPTS)return true;
  rec.count++;
  return false;
}

export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  // FIX #13: Rate-limit by IP
  const ip=req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()||req.socket.remoteAddress||'unknown';
  if(isRateLimited(ip))return res.status(429).json({error:'Too many attempts. Try again in 5 minutes.'});
  const ok=await verifyPassword(String(req.body?.password||''));
  if(!ok)return res.status(401).json({error:'Invalid password'});
  attemptTracker.delete(ip); // reset on success
  const sig=signSession();
  const secure=req.headers['x-forwarded-proto']==='https'||process.env.NODE_ENV==='production';
  res.setHeader('Set-Cookie',`admin_session=${sig}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.round(SESSION_TTL_MS/1000)}${secure?'; Secure':''}`);
  res.json({success:true});
}