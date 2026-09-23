import Document,{Html,Head,Main,NextScript} from 'next/document';

// ── Boot splash ────────────────────────────────────────────────────────────
// Raw HTML in the FIRST server response (before any JS runs), so the animation
// is visible on every page load — including slow networks and the hydration
// gap where previously nothing was shown. No text: the video IS the screen.
const SPLASH_STYLE=[
  '#pg-boot{position:fixed;inset:0;z-index:2147483000;background:#0b0712;',
  'opacity:1;transition:opacity .55s ease;pointer-events:none}',
  '#pg-boot video{display:block;width:100%;height:100%;object-fit:cover}',
  '#pg-boot.pg-hide{opacity:0;visibility:hidden}'
].join('');

// Guarantees: (1) visible >=1.4s even on instant loads ("sometimes it loads
// but not show loading"), (2) hides once the window has loaded, (3) hard 7s
// cap so it can never get stuck, (4) forces muted+play() because some mobile
// browsers ignore the attributes alone.
const SPLASH_SCRIPT=[
  '(function(){',
  'var el=document.getElementById("pg-boot");if(!el)return;',
  'var v=el.querySelector("video");',
  'if(v){try{v.muted=true;var p=v.play();if(p&&p.catch)p.catch(function(){});}catch(e){}}',
  'var t0=Date.now(),MIN=1400,MAX=7000,hidden=false;',
  'function hide(){if(hidden)return;hidden=true;el.classList.add("pg-hide");',
  'setTimeout(function(){el.style.display="none";},650);}',
  'function maybeHide(){var e=Date.now()-t0;if(e<MIN){setTimeout(maybeHide,MIN-e);return;}hide();}',
  'if(document.readyState==="complete")maybeHide();',
  'else window.addEventListener("load",maybeHide);',
  'setTimeout(hide,MAX);',
  '})();'
].join('');

// Literal attributes (autoplay/muted/loop/playsinline) must be in the served
// HTML for mobile autoplay policies — hence raw HTML, not React props.
const SPLASH_HTML='<video src="/poppygram.mp4" autoplay muted loop playsinline preload="auto"></video>';

export default class Doc extends Document{
  render(){return <Html lang="en"><Head>
    <link rel="manifest" href="/manifest.webmanifest"/>
    <meta name="theme-color" content="#0b0712"/>
    <meta name="mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
    <meta name="apple-mobile-web-app-title" content="PoppyGram"/>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
    <link rel="icon" href="/favicon.ico" sizes="any"/>
    <link rel="icon" href="/icons/icon-192.png" type="image/png" sizes="192x192"/>
    <link rel="apple-touch-icon" href="/icons/icon-180.png" sizes="180x180"/>
    <style dangerouslySetInnerHTML={{__html:SPLASH_STYLE}}/>
  </Head><body>
    <div id="pg-boot" dangerouslySetInnerHTML={{__html:SPLASH_HTML}}/>
    <script dangerouslySetInnerHTML={{__html:SPLASH_SCRIPT}}/>
    <Main/><NextScript/>
  </body></Html>}
}
