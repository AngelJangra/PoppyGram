// ---------------------------------------------------------------------------
// PROJECT CREDITS
// Single source of truth for the author credit shown on bot responses.
// Change the GitHub handle here and every reply/card updates automatically.
// ---------------------------------------------------------------------------
export const PROJECT_NAME='PoppyGram';
export const OWNER_NAME='drangeljangra';
export const GITHUB_USERNAME='AngelJangra';
export const GITHUB_URL=`https://github.com/${GITHUB_USERNAME}`;
export const SUPPORT_BOT='poppygramsupportbot';
export const SUPPORT_URL=`https://t.me/${SUPPORT_BOT}`;

// Marker used to guarantee the footer is appended only once per message.
export const CREDIT_MARK=`github.com/${GITHUB_USERNAME}`;
// Telegram hard limit for a single message body.
const MESSAGE_LIMIT=4096;

export function creditLine(){
  return `⚡ <i>Powered by</i> <a href="${GITHUB_URL}"><b>${GITHUB_USERNAME}</b></a>`;
}
export function creditButtons(){
  return [[{text:`⭐ GitHub — ${GITHUB_USERNAME}`,url:GITHUB_URL}]];
}

// Appends the author credit to a message body exactly once. Any message that is
// already at the Telegram size limit is trimmed so the credit always fits and
// sendMessage can never fail with "message is too long".
export function withCredit(text:string){
  const body=String(text||'');
  if(!body)return body;
  if(body.includes(CREDIT_MARK))return body;
  const footer=creditLine();
  const room=MESSAGE_LIMIT-footer.length-3;
  const head=body.length>room?`${body.slice(0,room>0?room:0)}…`:body;
  return `${head}\n\n${footer}`;
}

// Full credits card used by /credits and the About button.
export function creditsCard(supportUrl=SUPPORT_URL){
  const DIV='✦ ━━━━━━━━━━━━━ ✦';
  return `💎 <b>PROJECT CREDITS</b> 💎

${DIV}

🚀 <b>Project:</b> ${PROJECT_NAME}
👨‍💻 <b>Developer:</b> <a href="${GITHUB_URL}">${GITHUB_USERNAME}</a>
🐙 <b>GitHub:</b> <a href="${GITHUB_URL}">github.com/${GITHUB_USERNAME}</a>
👑 <b>Owner:</b> ${OWNER_NAME}
🆘 <b>Support:</b> @${SUPPORT_BOT}

${DIV}

🧠 <i>Bot engine, store system, hybrid Telegram auth and the admin console
were designed and built by ${GITHUB_USERNAME}.</i>

${DIV}

⭐ <i>Found this useful? Star the project on GitHub.</i>

🔗 ${supportUrl}`;
}

// Credit footer used inside keyboard layouts (e.g. store screens).
export function emptyReply(){ return {text:''}; }
