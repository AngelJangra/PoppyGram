import type {NextApiRequest,NextApiResponse} from 'next';
export default function handler(req:NextApiRequest,res:NextApiResponse){res.status(410).json({error:'Telegram MTProto ping is client-side only.'});}
