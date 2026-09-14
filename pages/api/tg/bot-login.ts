import type {NextApiRequest,NextApiResponse} from 'next';

// MTProto is intentionally NOT supported in Vercel serverless functions.
// Telegram login is performed by GramJS in the user's browser instead.
export default function handler(req:NextApiRequest,res:NextApiResponse){
  res.status(410).json({error:'MTProto login is client-side only. Use the Add Account page.'});
}
