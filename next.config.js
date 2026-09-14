/** @type {import('next').NextConfig} */
module.exports={
  reactStrictMode:true,
  output:'standalone',
  // FIX #24: Add security headers.
  async headers(){
    return[{
      source:'/(.*)',
      headers:[
        {key:'X-Content-Type-Options',value:'nosniff'},
        {key:'X-Frame-Options',value:'DENY'},
        {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
        {key:'X-XSS-Protection',value:'1; mode=block'},
      ],
    }];
  },
};