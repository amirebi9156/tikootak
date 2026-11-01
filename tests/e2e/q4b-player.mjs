import { chromium } from 'playwright';
import fs from 'node:fs';
const base='http://localhost:8080',J={'content-type':'application/json'};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
const sx=Date.now().toString(36).slice(-3);
async function code(){return (await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{...J,'x-admin-key':'adminkey'},body:JSON.stringify({max_uses:5,expires_days:1})})).json()).code;}
const reg=async(u)=>(await(await fetch(base+'/api/auth/register',{method:'POST',headers:J,body:JSON.stringify({invite:await code(),username:u,password:'test12345678'})})).json());
const A=await reg('mua'+sx), B=await reg('mub'+sx);
const api=async(t,m,p,b,h={})=>{const r=await fetch(base+p,{method:m,headers:{authorization:'Bearer '+t,...(b&&!Buffer.isBuffer(b)?J:{}),...h},body:b?(Buffer.isBuffer(b)?b:JSON.stringify(b)):undefined});let j=null;try{j=await r.json()}catch{}return {status:r.status,j};};
// ---- UI
const mx=(t,m,p,b)=>api(t,m,'/_matrix/client/v3'+p,b);
const room=(await mx(A.access_token,'POST','/createRoom',{name:'musicroom'+sx,preset:'private_chat'})).j;

const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const c=await mk.newContext({viewport:{width:1280,height:800},locale:'fa-IR'});const p=await c.newPage();
await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});
await p.goto(base);await p.getByLabel('نام کاربری').fill('mua'+sx);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:/^ورود$/}).click();
await p.waitForTimeout(6000);
async function sendAndPlay(roomName,label){
  await p.getByTestId('list-search').fill(roomName);await p.waitForTimeout(600);
  await p.locator('.sidebar button.room',{hasText:roomName}).first().click();await p.waitForTimeout(1500);
  await p.getByTestId('file-input').setInputFiles('long.mp3');
  await p.getByTestId('sp-send').click();await p.waitForTimeout(4000);
  const card=p.getByTestId('music-card').last();
  ok(await card.isVisible(),label+': music card shown');
  ok((await card.innerText()).length>3,label+': card has title/meta');
  ok(await card.getByText(/دانلود|دریافت/).count()===0,label+': no manual download step');
  ok(await card.getByTestId('music-add').count()===0,label+': no add button on the card (it lives in the context menu)');
  await p.screenshot({path:'q4-card-'+label.split(' ')[0]+'.png'});
  await card.getByTestId('music-play').click();
  await p.waitForTimeout(5000);
  ok(await p.getByTestId('player').isVisible(),label+': player bar opened after one tap');
  const st=await p.evaluate(()=>{const a=document.querySelector('audio:not(.voice-el)');return a?{t:a.currentTime,paused:a.paused,src:a.src.slice(0,5)}:null;});
  console.log(label,JSON.stringify(st));
  ok(!!st&&!st.paused&&st.t>0,label+': audio is playing');
  return card;
}

const card=await sendAndPlay('musicroom'+sx,'plain room');
const bub=await p.locator('.msg').filter({has:p.getByTestId('music-card')}).last().locator('.bubble').boundingBox();
console.log('bubble',JSON.stringify(bub));
ok(bub.width<300,'music bubble is compact ('+Math.round(bub.width)+'px)');
await p.screenshot({path:'q4b-card.png',clip:{x:bub.x-20,y:bub.y-20,width:bub.width+40,height:bub.height+40}});
await p.screenshot({path:'q4b-bar.png'});
await p.locator('.mini-open').click();await p.waitForTimeout(600);
const np=await p.getByTestId('nowplaying').boundingBox();
ok(np&&np.width<500&&np.height<780,'now-playing is a window, not fullscreen ('+Math.round(np.width)+'x'+Math.round(np.height)+')');
ok(await p.getByTestId('np-scrim').isVisible(),'dim backdrop visible');
await p.screenshot({path:'q4b-np.png'});
await p.mouse.click(20,400);await p.waitForTimeout(500);
ok(await p.getByTestId('nowplaying').count()===0,'click on backdrop closes it');
ok(await p.getByTestId('player').isVisible(),'player keeps playing in the bar');
await p.locator('.mini-open').click();await p.waitForTimeout(400);await p.keyboard.press('Escape');await p.waitForTimeout(400);
ok(await p.getByTestId('nowplaying').count()===0,'Escape closes it');
await mk.close();
