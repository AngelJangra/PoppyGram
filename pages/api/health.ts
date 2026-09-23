import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';
import {requireAdmin} from '../../lib/adminAuth';

export const config={api:{bodyParser:{sizeLimit:'1mb'}}};

export default async function h(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  if(!requireAdmin(req,res))return;

  const now=Date.now();
  // Keep this endpoint lightweight and resilient. A failed audit-log query must
  // not make the entire health response disappear.
  const accountsPromise=db.from('accounts').select('status,last_ping,next_ping_at');
  const schedulerPromise=db.from('audit_logs')
    .select('created_at').eq('event','scheduler.run')
    .order('created_at',{ascending:false}).limit(1).maybeSingle();

  const [{data:ac,error:errorAc},{data:recentLog,error:errorScheduler}]=await Promise.all([
    accountsPromise, schedulerPromise
  ]);

  const schedulerLastRun=recentLog?.created_at ? new Date(recentLog.created_at).getTime() : null;
  // The browser scheduler is intentionally allowed to be idle while the tab is
  // hidden. 15 minutes covers normal 5-minute runs without flapping the UI.
  const schedulerHealthy=schedulerLastRun!==null && Number.isFinite(schedulerLastRun) && (now-schedulerLastRun)<15*60*1000;

  const accounts=Array.isArray(ac)?ac:[];
  const response={
    database:!errorAc,
    telegramConfigured:!!process.env.NEXT_PUBLIC_TG_API_ID&&!!process.env.NEXT_PUBLIC_TG_API_HASH,
    scheduler:schedulerHealthy,
    schedulerMode:'browser',
    schedulerLastRun:recentLog?.created_at||null,
    schedulerCheckError:errorScheduler?true:false,
    accounts:accounts.length,
    active:accounts.filter(x=>x.status==='active').length,
    failed:accounts.filter(x=>x.status!=='active').length,
    due:accounts.filter(x=>x.next_ping_at&&new Date(x.next_ping_at).getTime()<=now).length,
    lastPing:accounts.map(x=>x.last_ping).filter(Boolean).sort().at(-1)||null,
  };

  // A transient scheduler-log failure should not turn the whole endpoint into
  // a 500. The database component is based on the primary accounts query.
  return res.status(200).json(response);
}
