import '../styles/globals.css';
import type {AppProps} from 'next/app';
import {useEffect} from 'react';

export default function App({Component,pageProps}:AppProps){
  useEffect(()=>{
    if(!('serviceWorker' in navigator))return;
    const register=()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
    if(document.readyState==='complete')register();
    else window.addEventListener('load',register,{once:true});
    return()=>window.removeEventListener('load',register);
  },[]);
  return <Component {...pageProps}/>;
}
