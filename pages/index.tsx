import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,Database,RefreshCw,Settings,Users,Clock3,Download,Upload,Trash2,Play,Pause,Search,LogOut,Sun,Moon,HeartPulse,MessageSquare,Eye,Zap,Send} from 'lucide-react';

type Account={phone:string;label?:string;meta?:{first_name?:string;last_name?:string;username?:string;tg_id?:string};status:string;ping_enabled:boolean;last_ping?:string;next_ping_at?:string;ping_interval_minutes?:number;failure_count?:number};
type Health={database:boolean;telegramConfigured:boolean;scheduler:boolean;accounts:number;active:number;failed:number;due:number;lastPing?:string};
const api=async(path:string,options?:RequestInit)=>{const r=await fetch(path,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||d.message||'Request failed');return d};
const SESSION_SECONDS=24*60*60; // match server SESSION_TTL_MS (24h)
const fmt=(s:number)=>{s=Math.max(0,s);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};

// Telegram/MTProto is deliberately browser-only. Vercel serverless functions never
// create a GramJS TelegramClient; the server only handles authenticated database work.
const TG_API_ID=Number(process.env.NEXT_PUBLIC_TG_API_ID||0);
const TG_API_HASH=process.env.NEXT_PUBLIC_TG_API_HASH||'';

type BrowserTelegram={client:any;mod:any};
async function browserClient(phone:string):Promise<BrowserTelegram>{
  if(!TG_API_ID||!TG_API_HASH)throw new Error('Telegram API credentials are not configured for the browser.');
  const r=await api('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});
  const mod:any=await import('telegram');
  const {StringSession}=await import('telegram/sessions');
  const client=new mod.TelegramClient(new StringSession(String(r.session||'')),TG_API_ID,TG_API_HASH,{connectionRetries:3,timeout:20});
  await client.connect();
  return {client,mod};
}
async function closeBrowserClient(client:any){try{await client?.disconnect()}catch{}}

async function pingAccount(phone:string):Promise<boolean>{
  const {client}=await browserClient(phone);
  try{await client.getMe();return true}finally{await closeBrowserClient(client)}
}

async function getTelegramServiceChat(phone:string):Promise<any[]>{
  const {client,mod}=await browserClient(phone);
  try{
    const peer=await client.getInputEntity(777000);
    const result:any=await client.invoke(new mod.Api.messages.GetHistory({peer,limit:100,offsetId:0,offsetDate:0,addOffset:0,maxId:0,minId:0,hash:0}));
    return result?.messages||[];
  }finally{await closeBrowserClient(client)}
}

async function getServiceNotifications(phone:string):Promise<any[]>{return getTelegramServiceChat(phone)}

async function sendTelegramMessage(fromPhone:string,to:string,text:string):Promise<void>{
  const {client}=await browserClient(fromPhone);
  try{const peer=await client.getInputEntity(to.trim());await client.sendMessage(peer,{message:text})}
  finally{await closeBrowserClient(client)}
}

function PWAControls(){
  const[installEvent,setInstallEvent]=useState<any>(null);
  const[online,setOnline]=useState(true);
  const[showIos,setShowIos]=useState(false);
  useEffect(()=>{
    setOnline(navigator.onLine);
    const onOnline=()=>setOnline(true),onOffline=()=>setOnline(false);
    window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline);
    const onBeforeInstall=(e:Event)=>{e.preventDefault();setInstallEvent(e)};
    window.addEventListener('beforeinstallprompt',onBeforeInstall);
    const ua=navigator.userAgent||'';
    const ios=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const standalone=window.matchMedia?.('(display-mode: standalone)').matches||!!(navigator as any).standalone;
    if(ios&&!standalone)setShowIos(true);
    return()=>{window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline);window.removeEventListener('beforeinstallprompt',onBeforeInstall)};
  },[]);
  const install=async()=>{
    if(!installEvent)return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(()=>null);
    setInstallEvent(null);
  };
  return <>
    {!online&&<div className="offline-bar" role="status">Offline — reconnect to use Telegram and live account data.</div>}
    {installEvent&&<button className="pwa-install" onClick={install}><Download size={16}/> Install app</button>}
    {showIos&&<button className="pwa-ios" onClick={()=>setShowIos(false)} aria-label="Dismiss iPhone install tip">On iPhone/iPad: Share → Add to Home Screen</button>}
  </>;
}

function Login(p:{onLogin:()=>void}){const{onLogin}=p;const[pa,setPa]=useState('');const[e,setE]=useState('');const submit=async(x:any)=>{x.preventDefault();setE('');try{await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pa})});onLogin()}catch(err:any){setE(err.message)}};return <main className="login"><div className="login-card"><div className="logo"><img src="/poppygram.png" alt="PoppyGram logo"/></div><h1>PoppyGram</h1><p>Administration console</p><form onSubmit={submit}><input type="password" value={pa} onChange={e=>setPa(e.target.value)} placeholder="Admin password" autoFocus/><button>🔐 Sign in</button>{e&&<div className="error">{e}</div>}</form><small>Private administration interface</small></div></main>}

function TGOfficialChat(p:{phone:string;onBack:()=>void}){
  const{phone,onBack}=p;
  const[msgs,setMsgs]=useState<any[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        // Full Telegram service chat (user 777000 / 42777): codes + ALL messages.
        const all=await getTelegramServiceChat(phone);
        if(!cancelled)setMsgs([...all].reverse()); // oldest first like a chat
      }catch(e:any){
        if(!cancelled)setError(e.message||'Failed to load official chat');
      }finally{
        if(!cancelled)setLoading(false);
      }
    })();
    return()=>{cancelled=true};
  },[phone]);
  useEffect(()=>{
    const el=document.getElementById('tg-chat-scroll');
    if(el)el.scrollTop=el.scrollHeight;
  },[msgs,loading]);
  return <div className="page"><section className="panel chat-panel">
    <div className="panel-head chat-head">
      <div className="chat-peer"><div className="chat-avatar">✈️</div><div><h3>Telegram <small className="chat-verified">✓</small></h3><p>42777 · service notifications · viewing as {phone}</p></div></div>
      <button className="back" onClick={onBack}>← Back</button>
    </div>
    <div id="tg-chat-scroll" className="chat-scroll">
    {loading&&<div className="loading">Loading Telegram chat (42777)...</div>}
    {error&&<div className="error">{error}</div>}
    {!loading&&!error&&msgs.length===0&&<div className="muted">No messages in Telegram chat (42777).</div>}
    {!loading&&!error&&msgs.map((m:any,i)=>{
      const date=m.date?new Date(m.date*1000).toLocaleString():'';
      const text=m.message||(m.action?'(service: '+(m.action?.className||m.className)+')':'(service message)');
      const codeMatch=String(m.message||'').match(/(\d{5})/);
      const out=!!m.out;
      return <div className={'bubble-row '+(out?'out':'in')} key={m.id||i}>
        <div className={'bubble '+(out?'bubble-out':'bubble-in')}>
          <div className="bubble-text">{text}</div>
          <div className="bubble-meta"><span>{date}</span>{codeMatch&&<span className="bubble-code">code {codeMatch[1]}</span>}{out&&<span>✓✓</span>}</div>
        </div>
      </div>;
    })}
    </div>
    <div className="chat-foot muted">Read-only service chat · use Send Message tab to reply via your accounts</div>
  </section></div>;
}
function AddAccount(p:{onDone:()=>void}){
  const{onDone}=p;
  const[phone,setPhone]=useState('');
  const[code,setCode]=useState('');
  const[password,setPassword]=useState('');
  const[step,setStep]=useState<'phone'|'code'|'password'|'done'>('phone');
  const[msg,setMsg]=useState('');
  const[info,setInfo]=useState('');
  const[loading,setLoading]=useState(false);
  const stateRef=useRef<{client:any;mod:any;codeHash:string}|null>(null);

  const cleanup=async()=>{if(stateRef.current?.client){await closeBrowserClient(stateRef.current.client);stateRef.current=null}}
  useEffect(()=>()=>{void cleanup()},[]);

  const saveDone=async(client:any)=>{
    const me:any=await client.getMe();
    const session=String(client.session.save());
    const meta={first_name:me.firstName||'',last_name:me.lastName||'',username:me.username||'',tg_id:String(me.id||'')};
    await api('/api/save-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:phone.trim(),session,meta})});
    await cleanup();
    setStep('done');
    setInfo('Added @'+(meta.username||meta.first_name||phone.trim()));
  };

  const start=async()=>{
    setMsg('');
    const pn=phone.trim().replace(/\s+/g,'');
    if(!/^\+?\d{7,15}$/.test(pn)){setMsg('Enter a valid phone in international format, e.g. +919876543210');return}
    if(!TG_API_ID||!TG_API_HASH){setMsg('Telegram browser credentials are not configured. Add NEXT_PUBLIC_TG_API_ID and NEXT_PUBLIC_TG_API_HASH in Vercel.');return}
    setLoading(true);
    try{
      const mod:any=await import('telegram');
      const {StringSession}=await import('telegram/sessions');
      const client=new mod.TelegramClient(new StringSession(''),TG_API_ID,TG_API_HASH,{connectionRetries:3,timeout:20});
      await client.connect();
      const sent:any=await client.sendCode({apiId:TG_API_ID,apiHash:TG_API_HASH},pn);
      stateRef.current={client,mod,codeHash:String(sent.phoneCodeHash||'')};
      setPhone(pn);setCode('');setStep('code');
      setInfo(sent.type?.className==='auth.SentCodeTypeApp'?'Code sent in Telegram':'Code sent by Telegram');
    }catch(e:any){setMsg(String(e?.message||e?.errorMessage||'Failed to send Telegram code'));await cleanup()}
    finally{setLoading(false)}
  };

  const submitCode=async()=>{
    setMsg('');
    if(!code.trim()){setMsg('Enter the login code');return}
    if(!stateRef.current){setMsg('Login session expired. Start again.');setStep('phone');return}
    setLoading(true);
    try{
      // Direct SignIn with the ORIGINAL codeHash.
      // (client.signInUser re-sends a code internally, invalidating this hash,
      // and loops forever on errors when onError returns falsy — freezing the page.)
      await stateRef.current.client.invoke(
        new stateRef.current.mod.Api.auth.SignIn({phoneNumber:phone.trim(),phoneCodeHash:stateRef.current.codeHash,phoneCode:code.trim()})
      );
      await saveDone(stateRef.current.client);
    }catch(e:any){
      const m=String(e?.message||e?.errorMessage||'');
      if(m.includes('SESSION_PASSWORD_NEEDED')){setPassword('');setStep('password');setInfo('This account uses Telegram 2-step verification. The password stays in this browser.');}
      else if(m.includes('PHONE_CODE_INVALID'))setMsg('Wrong login code.');
      else if(m.includes('PHONE_CODE_EXPIRED')||m.includes('PHONE_CODE_HASH_EXPIRED'))setMsg('Code expired. Start again and request a new code.');
      else if(m.includes('FLOOD_WAIT'))setMsg('Too many attempts. '+m);
      else setMsg(m||'Failed to verify code');
    }finally{setLoading(false)}
  };

  const submitPassword=async()=>{
    setMsg('');
    if(!password){setMsg('Enter your Telegram cloud password');return}
    if(!stateRef.current){setMsg('Login session expired. Start again.');setStep('phone');return}
    setLoading(true);
    try{
      const {computeCheck}=await import('telegram/Password');
      const pwd:any=await stateRef.current.client.invoke(new stateRef.current.mod.Api.account.GetPassword());
      const check=await computeCheck(pwd,password);
      await stateRef.current.client.invoke(new stateRef.current.mod.Api.auth.CheckPassword({password:check}));
      await saveDone(stateRef.current.client);
      setPassword('');
    }catch(e:any){
      const m=String(e?.message||e?.errorMessage||'');
      setMsg(m.includes('PASSWORD_HASH_INVALID')?'Wrong Telegram cloud password.':m||'2FA verification failed');
    }finally{setLoading(false)}
  };

  return <div className="page"><section className="panel" style={{maxWidth:480}}>
    <h3>Add Telegram account</h3>
    <p className="muted">MTProto login runs entirely in this browser. Vercel only receives the resulting session to encrypt and store it.</p>
    {step==='phone'&&<><label>Phone number<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+919876543210" className="finput" autoComplete="tel"/></label><button className="primary" onClick={start} disabled={loading} style={{marginTop:12}}>{loading?'Connecting…':'Send code'}</button></>}
    {step==='code'&&<><p>{info||'Enter the login code Telegram sent you.'}</p><button className="button" onClick={start} disabled={loading} style={{marginBottom:10}}>{loading?'Sending…':'Resend code'}</button><label>Login code<input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} placeholder="12345" maxLength={6} className="finput" inputMode="numeric" autoFocus/></label><button className="primary" onClick={submitCode} disabled={loading} style={{marginTop:12}}>{loading?'Verifying…':'Verify code'}</button></>}
    {step==='password'&&<><p>{info}</p><label>2FA password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Telegram cloud password" className="finput" autoComplete="current-password" autoFocus/></label><button className="primary" onClick={submitPassword} disabled={loading} style={{marginTop:12}}>{loading?'Verifying…':'Sign in'}</button></>}
    {step==='done'&&<div className="ok">{info}</div>}
    {msg&&<div className="error" style={{marginTop:10}}>{msg}</div>}
    {step!=='done'&&<button className="button" onClick={onDone} style={{marginTop:10}} disabled={loading}>Cancel</button>}
    {step==='done'&&<button className="primary" onClick={onDone} style={{marginTop:12}}>Done</button>}
  </section></div>;
}
function OTPModal(p:{phone:string;onClose:()=>void}){
  const{phone,onClose}=p;
  const[loading,setLoading]=useState(true);
  const[notifications,setNotifications]=useState<any[]>([]);
  const[error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const n=await getServiceNotifications(phone);
        if(!cancelled)setNotifications([...n].reverse());
      }catch(e:any){
        if(!cancelled)setError(e.message);
      }finally{
        if(!cancelled)setLoading(false);
      }
    })();
    return()=>{cancelled=true};
  },[phone]);
  useEffect(()=>{
    const el=document.getElementById('tg-modal-scroll');
    if(el)el.scrollTop=el.scrollHeight;
  },[notifications,loading]);
  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal chat-modal" onClick={e=>e.stopPropagation()}>
      <div className="modal-head chat-head">
        <div className="chat-peer"><div className="chat-avatar">✈️</div><div><h3>Telegram <small className="chat-verified">✓</small></h3><p>42777 · {phone}</p></div></div>
        <button className="icon" onClick={onClose}>✕</button>
      </div>
      <div id="tg-modal-scroll" className="chat-scroll chat-scroll-modal">
      {loading&&<div className="loading">Loading Telegram chat (42777)...</div>}
      {error&&<div className="error">{error}</div>}
      {!loading&&!error&&notifications.length===0&&<div className="muted">No messages in Telegram chat (42777).</div>}
      {!loading&&!error&&notifications.map((n:any,i)=>{
        const date=new Date((n.date||0)*1000).toLocaleString();
        const msg=n.message||(n.action?'(service: '+(n.action?.className||'unknown')+')':'(service message)');
        const codeMatch=String(msg).match(/(\d{5})/);
        const out=!!n.out;
        return <div className={'bubble-row '+(out?'out':'in')} key={i}>
          <div className={'bubble '+(out?'bubble-out':'bubble-in')}>
            <div className="bubble-text">{msg}</div>
            <div className="bubble-meta"><span>{date}</span>{codeMatch&&<span className="bubble-code">code {codeMatch[1]}</span>}{out&&<span>✓✓</span>}</div>
          </div>
        </div>;
      })}
      </div>
    </div>
  </div>;
}
function SendMessage(p:{accounts:Account[]}){
  const{accounts}=p;
  const list=Array.isArray(accounts)?accounts:[];
  const[from,setFrom]=useState(list[0]?.phone||'');
  const[to,setTo]=useState('');
  const[text,setText]=useState('');
  const[sending,setSending]=useState(false);
  const[status,setStatus]=useState('');
  useEffect(()=>{if(!from&&list[0])setFrom(list[0].phone)},[accounts]);
  const send=async()=>{
    setStatus('');
    if(!from){setStatus('Select an account to send from');return}
    if(!to.trim()){setStatus('Enter a username (@user) or mobile number (+phone)');return}
    if(!text.trim()){setStatus('Write your message');return}
    setSending(true);
    try{
      await sendTelegramMessage(from,to.trim(),text);
      setStatus('✅ Sent from '+from+' to '+to.trim());
      setText('');
    }catch(e:any){
      setStatus('❌ '+(e?.message||'Failed to send'));
    }finally{
      setSending(false);
    }
  };
  return <div className="page"><section className="panel send-panel">
    <div className="panel-head"><div><h3>✉️ Send Message</h3><p>Pick an account, enter any username or mobile number, write the full message, then Send.</p></div></div>
    <div className="send-grid">
      <label>From account (dropdown)<select value={from} onChange={e=>setFrom(e.target.value)} className="finput">
        {list.length===0&&<option value="">No accounts</option>}
        {list.map(a=><option key={a.phone} value={a.phone}>{a.meta?.first_name||a.label||a.phone} — {a.phone}{a.meta?.username?' (@'+a.meta.username+')':''}</option>)}
      </select></label>
      <label>To — username or mobile number<input value={to} onChange={e=>setTo(e.target.value)} placeholder="@username or +919876543210" className="finput"/></label>
    </div>
    <label>Message<section className="send-box"><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Write the whole message here…" rows={6} className="finput send-textarea"/></section></label>
    <div className="send-actions"><button className="primary" onClick={send} disabled={sending}><Send size={16}/>{sending?'Sending…':'Send'}</button></div>
    {status&&<div className={status.startsWith('❌')?'error':'ok'} style={{marginTop:10}}>{status}</div>}
  </section></div>;
}
function Accounts(p:{accounts:Account[];q:string;setQ:(s:string)=>void;action:(p:string,b?:any)=>void;onOpen:(p:string)=>void}){
  const{accounts,q,setQ,action,onOpen}=p;
  const[phone,setPhone]=useState('');
  const[pinging,setPinging]=useState<string|null>(null);
  const[pingingAll,setPingingAll]=useState(false);
  const[otpPhone,setOtpPhone]=useState<string|null>(null);
  const[pingMsg,setPingMsg]=useState('');

  const doPing=async(phone:string)=>{
    setPinging(phone);setPingMsg('');
    try{
      await pingAccount(phone);
      setPingMsg(`✅ Ping success: ${phone}`);
    }catch(e:any){
      setPingMsg(`❌ Ping failed: ${phone} — ${e.message}`);
    }finally{
      setPinging(null);
    }
  };

  const pingAll=async()=>{
    setPingingAll(true);setPingMsg('');
    let success=0,failed=0;
    for(const a of accounts){
      if(!a.ping_enabled)continue;
      try{await pingAccount(a.phone);success++}catch{failed++}
    }
    setPingMsg(`✅ Pinged ${success} accounts, ${failed} failed`);
    setPingingAll(false);
  };

  if(otpPhone)return <OTPModal phone={otpPhone} onClose={()=>setOtpPhone(null)}/>;

  return <div className="page"><div className="toolbar">
    <div className="search"><Search size={18}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search accounts…"/></div>
    <form onSubmit={e=>{e.preventDefault();if(phone)action('/api/add',{phone});setPhone('')}} className="qadd"><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+phone (quick add)" className="qinput"/><button className="primary" type="submit">Add</button></form>
    <button onClick={pingAll} disabled={pingingAll} className="secondary">{pingingAll?'⏳ Pinging...':'⚡ Ping all'}</button>
  </div>
  {pingMsg&&<div className={pingMsg.includes('❌')?'error':'ok'}>{pingMsg}</div>}
  <div className="table account-list"><div className="thead"><span>Account</span><span>Status</span><span>Interval</span><span>Next ping</span><span>Actions</span></div>
    {(Array.isArray(accounts)?accounts:[]).map((a:Account)=><div className="tr" key={String(a.phone||Math.random())}><div><b>{a.meta?.first_name||a.phone}</b><small>{a.phone}{a.meta?.username?'  @'+a.meta.username:''}</small></div>
      <span className={'tag '+(a.status==='active'?'ok':'bad')}>{a.status}</span>
      <span>{a.ping_interval_minutes||60}m</span>
      <span>{a.next_ping_at?new Date(a.next_ping_at).toLocaleString():'—'}</span>
      <span className="act">
        <button className="icon" title="Ping now" disabled={pinging===a.phone} onClick={()=>doPing(a.phone)}>{pinging===a.phone?<RefreshCw size={15} className="spin"/>:<Zap size={15}/>}</button>
        <button className="icon" title="View OTP" onClick={()=>setOtpPhone(a.phone)}><Eye size={15}/></button>
        <button className="icon" title="Open Telegram official chat" onClick={()=>onOpen(a.phone)}><MessageSquare size={15}/></button>
        <button className="icon" title={a.ping_enabled?'Pause':'Resume'} onClick={()=>action('/api/toggle-ping',{phone:a.phone,enabled:!a.ping_enabled})}>{a.ping_enabled?<Pause size={15}/>:<Play size={15}/>}</button>
        <button className="icon" title="Remove" onClick={()=>action('/api/remove',{phone:a.phone})}><Trash2 size={15}/></button>
      </span></div>)}
  </div></div>;
}
function Health(p:{health:Health|null;accounts:Account[];logs:any[]}){const{health,accounts,logs}=p;const ac=accounts||[];const lg=logs||[];return <div className="page"><div className="grid2"><div><section className="panel"><h3>Components</h3><Status label="Supabase database" ok={!!health?.database}/><Status label="Telegram API configuration" ok={!!health?.telegramConfigured}/><Status label="Ping scheduler" ok={!!health?.scheduler}/></section><div className="panel" style={{marginTop:16}}><h3>Runtime</h3><div className="kv"><span>Accounts</span><b>{health?.accounts??0}</b></div><div className="kv"><span>Active</span><b>{health?.active??0}</b></div><div className="kv"><span>Failed</span><b>{health?.failed??0}</b></div><div className="kv"><span>Due now</span><b>{health?.due??0}</b></div></div></div><section className="panel"><h3>Health events</h3>{lg.slice(0,20).map((l:any,i)=><div className="log" key={i}><span>{new Date(l.created_at).toLocaleString()}</span><b>{l.event}</b><small>{l.message}</small></div>)}</section></div></div>}
function Scheduler(p:{accounts:Account[];settings:any;runDue:()=>Promise<void>}){const{accounts,settings,runDue}=p;const ac=accounts||[];return <div className="page"><section className="panel"><div className="panel-head"><div><h3>Browser ping scheduler</h3><p>MTProto checks run in the open admin browser because Vercel serverless functions cannot host the Telegram client reliably.</p></div><button className="primary" onClick={runDue}>Run due jobs</button></div><div className="kv"><span>Default interval</span><b>{settings.ping_interval_minutes||60} minutes</b></div><div className="kv"><span>Max attempts</span><b>{settings.max_attempts||3}</b></div></section><div className="table account-list scheduler-list"><div className="thead"><span>Account</span><span>Status</span><span>Interval</span><span>Next ping</span><span>Failures</span></div>{ac.map(a=><div className="tr" key={String(a.phone)}><div><b>{a.meta?.first_name||a.phone}</b><small>{a.phone}</small></div><span>{a.ping_enabled?'Running':'Paused'}</span><span>{a.ping_interval_minutes||settings.ping_interval_minutes||60}m</span><span>{a.next_ping_at?new Date(a.next_ping_at).toLocaleString():'—'}</span><span>{a.failure_count||0}</span></div>)}</div></div>}
function Backups(p:{action:(p:string,b?:any)=>void}){const{action}=p;return <div className="page"><section className="panel"><h3>Backup & restore</h3><p>Backups contain account metadata and encrypted session records. Treat exported files as sensitive.</p><div className="backup-actions"><button className="primary" onClick={()=>location.href='/api/export'}><Download size={17}/>Export backup</button><label className="button"><Upload size={17}/>Import JSON<input hidden type="file" accept="application/json" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());action('/api/import',{data})}catch{alert('Invalid backup JSON')}}}/></label></div></section><section className="panel"><h3>Backup safeguards</h3><Status label="Schema validation" ok text="Enabled"/><Status label="Duplicate protection" ok text="Enabled"/><Status label="Sensitive-field warning" ok text="Enabled"/></section></div>}
function SettingsPage(p:{settings:any;setSettings:(x:any)=>void;action:(p:string,b?:any)=>void}){const{settings,setSettings,action}=p;return <div className="page"><section className="panel form"><h3>General</h3><label>Site name<input value={settings.site_name||'PoppyGram'} onChange={e=>setSettings({...settings,site_name:e.target.value})}/></label><label>Default ping interval (minutes)<input type="number" min="5" value={settings.ping_interval_minutes||60} onChange={e=>setSettings({...settings,ping_interval_minutes:Number(e.target.value)})}/></label><label>Maximum ping attempts<input type="number" min="1" max="10" value={settings.max_attempts||3} onChange={e=>setSettings({...settings,max_attempts:Number(e.target.value)})}/></label><button className="primary" onClick={()=>action('/api/settings',{settings})}>Save settings</button></section><section className="panel"><h3>Authentication</h3><p>Authentication uses a bcrypt-hashed admin password.</p><div className="mono">ADMIN_PASSWORD_HASH = bcrypt hash</div><small>Set ADMIN_PASSWORD_HASH in .env.local to change it (hash never reveals the password).</small></section></div>}

function Status(p:{label:string;ok:boolean;text?:string}){const{label,ok,text}=p;return <div className="status"><span className={ok?'dot ok':'dot bad'}></span><b>{label}</b><span>{text||(ok?'Healthy':'Unavailable')}</span></div>}

function App(){
  const[logged,setLogged]=useState<boolean|null>(null);
  const[tab,setTab]=useState('dashboard');
  const[accounts,setAccounts]=useState<Account[]>([]);
  const[health,setHealth]=useState<Health|null>(null);
  const[logs,setLogs]=useState<any[]>([]);
  const[settings,setSettings]=useState<any>({});
  const[q,setQ]=useState('');
  const accountsRef=useRef<Account[]>([]);
  // Must be declared before every conditional return so the hook order never changes.
  const schedulerBusyRef=useRef(false);
  const[dark,setDark]=useState(false);
  const[msg,setMsg]=useState('');
  const[tgPhone,setTgPhone]=useState<string|null>(null);
  const[expiresAt,setExpiresAt]=useState<number|null>(null);
  const[remain,setRemain]=useState(SESSION_SECONDS);

  const load=async()=>{
    // Do not use one Promise.all for the whole dashboard: a transient failure
    // in logs/settings/accounts must not erase a perfectly good health result.
    const results=await Promise.allSettled([
      api('/api/health'),
      api('/api/logs'),
      api('/api/settings'),
      api('/api/accounts'),
    ]);
    const [h,l,s,a]=results;
    if(h.status==='fulfilled' && h.value) setHealth(h.value as Health);
    if(l.status==='fulfilled') setLogs(Array.isArray((l.value as any)?.logs)?(l.value as any).logs:(Array.isArray(l.value)?l.value:[]));
    if(s.status==='fulfilled') setSettings(((s.value as any)?.settings||s.value||{}) as any);
    if(a.status==='fulfilled'){const rawA=(a.value as any)?.accounts??a.value;setAccounts(Array.isArray(rawA)?rawA:[]);}
  };

  useEffect(()=>{accountsRef.current=accounts},[accounts]);
  useEffect(()=>{
    if(!logged)return;
    void load();
    // Health is a live status page. Refresh independently so temporary network
    // or Supabase hiccups recover automatically instead of leaving stale
    // 'Unavailable' indicators on screen.
    const t=setInterval(()=>void load(),30*1000);
    return()=>clearInterval(t);
  },[logged]);

  useEffect(()=>{
    const check=async()=>{try{const r:any=await api('/api/auth/check');if(r&&r.loggedIn){setLogged(true);setExpiresAt((r&&r.expiresAt)||Date.now()+SESSION_SECONDS*1000)}else{setLogged(false)}}catch{setLogged(false)}};
    check();
  },[]);

  // Session countdown. The server session lasts 24h; signing in again is required after expiry.
  useEffect(()=>{
    if(!logged||expiresAt===null)return;
    const tick=()=>{
      const r=Math.max(0,Math.ceil((expiresAt-Date.now())/1000));
      if(r<=0){setRemain(0);api('/api/auth/logout').catch(()=>{});setLogged(false);return}
      setRemain(r);
    };
    tick();
    const t=setInterval(tick,1000);
    return ()=>clearInterval(t);
  },[logged,expiresAt]);

  const filtered=useMemo(()=>{const arr=Array.isArray(accounts)?accounts:[];return arr.filter(a=>(a.phone+' '+(a.label||'')+' '+(a.meta?.username||'')+' '+(a.meta?.first_name||'')).toLowerCase().includes(q.toLowerCase()))},[accounts,q]);

  // IMPORTANT: every hook must run on every render. This scheduler effect used
  // to sit below the logged/tgPhone early returns, which caused React error #310
  // when authentication state changed. Keep it before all conditional returns.
  useEffect(()=>{
    if(!logged)return;
    void runDue();
    const t=setInterval(()=>{if(document.visibilityState==='visible')void runDue()},5*60*1000);
    const onVisible=()=>{if(document.visibilityState==='visible')void runDue()};
    document.addEventListener('visibilitychange',onVisible);
    return()=>{clearInterval(t);document.removeEventListener('visibilitychange',onVisible)};
  },[logged]);

  if(logged===null)return <div className="loading">Loading…</div>;
  if(!logged)return <Login onLogin={()=>{setLogged(true);setExpiresAt(Date.now()+SESSION_SECONDS*1000);setRemain(SESSION_SECONDS);load()}}/>;
  if(tgPhone)return <TGOfficialChat phone={tgPhone} onBack={()=>{setTgPhone(null);load()}}/>;
  const action=async(path:string,body?:any)=>{try{await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});setMsg('Done');await load()}catch(e:any){setMsg(e.message)}};
  const runDue=async()=>{
    if(schedulerBusyRef.current)return;
    schedulerBusyRef.current=true;
    try{
      const plan:any=await api('/api/ping-all?manual=true');
      const due:Array<Account>=Array.isArray(plan?.due)?plan.due:[];
      let success=0,failed=0;
      for(const a of due){
        try{
          await pingAccount(a.phone);
          await api('/api/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:a.phone,success:true})});
          success++;
        }catch(e:any){
          failed++;
          await api('/api/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:a.phone,success:false,error:String(e?.message||'Telegram ping failed')})}).catch(()=>{});
        }
      }
      setMsg(`Scheduler: ${success} succeeded, ${failed} failed`);
      await load();
    }catch(e:any){setMsg(e?.message||'Scheduler failed')}
    finally{schedulerBusyRef.current=false}
  };
  const logout=async()=>{await api('/api/auth/logout');setLogged(false)};
  const tabs:any=[['dashboard','Dashboard',Activity],['accounts','Accounts',Users],['add','Add account',Users],['send','Send message',Send],['health','System health',HeartPulse],['scheduler','Scheduler',Clock3],['backups','Backup & restore',Database],['settings','Settings',Settings]];
  return <div className={dark?'app dark':'app'}>
    <aside><div className="brand"><img src="/poppygram.png" alt="PoppyGram logo"/><b>PoppyGram</b></div>
      {tabs.map(([id,name,Icon]:any)=><button className={tab===id?'nav active':'nav'} onClick={()=>setTab(id)} key={id}><Icon size={18}/>{name}</button>)}
      <div className="side-bottom"><button className="nav" onClick={()=>setDark(!dark)}>{dark?<Sun size={18}/>:<Moon size={18}/>}{dark?'Light':'Dark'}</button><button className="nav danger" onClick={logout}><LogOut size={18}/>Sign out</button></div></aside>
    <main className="main"><PWAControls/><header><div><h2>{tabs.find((t:any)=>t[0]===tab)?.[1]||'Dashboard'}</h2><div className="sub">PoppyGram administration console</div></div><span className={"timer"+(remain<=30?' timer-warn':'')} title="Admin session time remaining">{fmt(remain)}</span><div className="msgbox">{msg}</div></header>
      {tab==='dashboard'&&<Health health={health} accounts={accounts} logs={logs}/>}
      {tab==='accounts'&&<Accounts accounts={filtered} q={q} setQ={setQ} action={action} onOpen={(p:string)=>setTgPhone(p)}/>}
      {tab==='add'&&<AddAccount onDone={()=>{setTab('accounts');load()}}/>}
      {tab==='send'&&<SendMessage accounts={accounts}/>}
      {tab==='health'&&<Health health={health} accounts={accounts} logs={logs}/>}
      {tab==='scheduler'&&<Scheduler accounts={accounts} settings={settings} runDue={runDue}/>}
      {tab==='backups'&&<Backups action={action}/>}
      {tab==='settings'&&<SettingsPage settings={settings} setSettings={setSettings} action={action}/>}
    </main></div>;
}
export default App;
