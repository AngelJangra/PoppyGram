import type {NextApiRequest,NextApiResponse} from 'next';
export default function h(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const secure=req.headers['x-forwarded-proto']==='https'||process.env.NODE_ENV==='production';
  res.setHeader('Set-Cookie',`admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`);
  res.setHeader('Cache-Control','no-store');
  res.json({success:true});
}
