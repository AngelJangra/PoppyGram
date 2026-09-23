import '../styles/globals.css';
import type {AppProps} from 'next/app';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/router';

const ROUTE_STYLE=[
  '.pg-route-splash{position:fixed;inset:0;z-index:2147483000;background:#0b0712;',
  'pointer-events:none;animation:pg-splash-in .22s ease both}',
  '.pg-route-splash video{display:block;width:100%;height:100%;object-fit:cover}',
  '@keyframes pg-splash-in{from{opacity:0}to{opacity:1}}'
].join('');

function NavSplash(){
  const ref=useRef<HTMLVideoElement|null>(null);
  useEffect(()=>{
    const v=ref.current;
    if(!v)return;
    // Some mobile browsers ignore autoPlay/muted props until set imperatively.
    v.muted=true;
    v.play().catch(()=>{});
  },[]);
  return <div className="pg-route-splash" aria-hidden="true">
    <video ref={ref} src="/poppygram.mp4" autoPlay muted loop playsInline preload="auto"/>
  </div>;
}

export default function App({Component,pageProps}:AppProps){
  const router=useRouter();
  const[navLoading,setNavLoading]=useState(false);
  const hideTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const navStartRef=useRef(0);

  useEffect(()=>{
    if(!('serviceWorker' in navigator))return;
    const register=()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
    if(document.readyState==='complete')register();
    else window.addEventListener('load',register,{once:true});
    return()=>window.removeEventListener('load',register);
  },[]);

  // Client-side navigations never re-run the _document boot splash, so show
  // the same mp4 (no text) on every route change — always for a minimum
  // duration so even instant navigations visibly show it.
  useEffect(()=>{
    const clear=()=>{if(hideTimer.current){clearTimeout(hideTimer.current);hideTimer.current=null;}};
    const start=()=>{clear();navStartRef.current=Date.now();setNavLoading(true);};
    const done=()=>{
      clear();
      const wait=Math.max(0,450-(Date.now()-navStartRef.current));
      hideTimer.current=setTimeout(()=>setNavLoading(false),wait);
    };
    router.events.on('routeChangeStart',start);
    router.events.on('routeChangeComplete',done);
    router.events.on('routeChangeError',done);
    return()=>{
      router.events.off('routeChangeStart',start);
      router.events.off('routeChangeComplete',done);
      router.events.off('routeChangeError',done);
      clear();
    };
  },[router.events]);

  return <>
    <style dangerouslySetInnerHTML={{__html:ROUTE_STYLE}}/>
    <Component {...pageProps}/>
    {navLoading&&<NavSplash/>}
  </>;
}
