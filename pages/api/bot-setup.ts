// FIX #14: Read secret from Authorization header instead of query param.
import type {NextApiRequest,NextApiResponse} from 'next';
import {db} from '../../lib/db';
import {setWebhook,getWebhookInfo,botToken,setMyCommands,BOT_COMMANDS} from '../../lib/bot';

export const config={api:{bodyParser:{sizeLimit:'1mb'}}};

export default async function h(req:NextApiRequest,res:NextApiResponse){
  const auth=req.headers.authorization?.replace('Bearer ','')||'';
  if(!process.env.CRON_SECRET||auth!==process.env.CRON_SECRET){
    return res.status(401).json({error:'Unauthorized'});
  }
  if(!botToken())return res.status(400).json({error:'TG_BOT_TOKEN not set in environment'});

  const base=String(process.env.SITE_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||'').replace(/\/$/,'');
  if(!base)return res.status(500).json({error:'SITE_URL or VERCEL_PROJECT_PRODUCTION_URL is not configured'});
  const url=`${base}/api/bot`;
  const secret=process.env.TG_BOT_WEBHOOK_SECRET||'';
  const drop=String((req.query as any)?.drop||'').toLowerCase()==='true';
  try{
    // Never wipe the pending queue by default — pass ?drop=true only for a clean reset.
    await setWebhook(url,secret||undefined,drop);
    // Single source of truth: lib/bot.ts BOT_COMMANDS (also refreshed by /syncmenu).
    await setMyCommands(BOT_COMMANDS);
    const info=await getWebhookInfo();
    const {error:logError}=await db.from('audit_logs').insert({event:'bot.webhook_set',message:`Webhook set to ${url}`}); if(logError)console.error('[audit]',logError);
    return res.json({ok:true,url,pending:info.pending_update_count});
  }catch(e:any){
    return res.status(500).json({error:String(e?.message||'Failed to set webhook')});
  }
}