import type {NextApiRequest,NextApiResponse} from 'next';
export default function h(req:NextApiRequest,res:NextApiResponse){if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});res.setHeader('Set-Cookie','admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure');res.json({success:true})}
