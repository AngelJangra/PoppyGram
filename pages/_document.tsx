import Document,{Html,Head,Main,NextScript} from 'next/document';
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
  </Head><body><Main/><NextScript/></body></Html>}
}
