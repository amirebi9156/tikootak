// Glass mini-player bar (desktop + phone), full-screen -> floating window, drag, keyboard move.
import { chromium } from 'playwright';
const base='http://localhost:8080',J={'content-type':'application/json'};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
const sx=Date.now().toString(36).slice(-3);
async function code(){return (await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{...J,'x-admin-key':'adminkey'},body:JSON.stringify({max_uses:5,expires_days:1})})).json()).code;}
const reg=async(u)=>(await(await fetch(base+'/api/auth/register',{method:'POST',headers:J,body:JSON.stringify({invite:await code(),username:u,password:'test12345678'})})).json());
const A=await reg('gpa'+sx);
const mx=async(t,m,p,b)=>(await fetch(base+'/_matrix/client/v3'+p,{method:m,headers:{...J,authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined})).json();
const r=await mx(A.access_token,'POST','/createRoom',{name:'gproom'+sx,preset:'private_chat'});
for(let i=0;i<8;i++)await mx(A.access_token,'PUT','/rooms/'+encodeURIComponent(r.room_id)+'/send/m.room.message/m'+i,{msgtype:'m.text',body:'پیام شماره '+i+' برای تست پس‌زمینهٔ شیشه'});
const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
async function boot(opts){
  const c=await mk.newContext({locale:'fa-IR',...opts});const p=await c.newPage();
  await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});
  await p.goto(base+'/?start=1');await p.getByLabel('نام کاربری').fill('gpa'+sx);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:/^ورود$/}).click();
  await p.waitForTimeout(6000);
  await p.locator('.sidebar button.room',{hasText:'gproom'+sx}).first().click();await p.waitForTimeout(1500);
  await p.getByTestId('file-input').setInputFiles('long.mp3');await p.getByTestId('sp-send').click();await p.waitForTimeout(4000);
  await p.getByTestId('music-play').last().click();await p.waitForTimeout(2500);
  return p;
}
const inView=async(p,loc)=>{const b=await loc.boundingBox();const v=p.viewportSize();return !!b&&b.x>=-1&&b.y>=-1&&b.x+b.width<=v.width+1&&b.y+b.height<=v.height+1;};

// ---------- desktop ----------
{
  const p=await boot({viewport:{width:1280,height:800}});
  const bar=p.getByTestId('player');
  ok(await bar.isVisible(),'desktop: bar visible');
  const bb=await bar.boundingBox();
  ok(bb.width<=770&&bb.width>400,'desktop: bar is a centred capsule, not full width ('+Math.round(bb.width)+'px)');
  const cs=await bar.evaluate(e=>{e=e.closest('.pin-stack')||e;const s=getComputedStyle(e);return {r:parseFloat(s.borderTopLeftRadius),bf:s.backdropFilter||s.webkitBackdropFilter,sw:e.scrollWidth,cw:e.clientWidth};});
  ok(cs.r>=20,'desktop: rounded glass ('+cs.r+'px)');
  ok(/blur|url/.test(cs.bf),'desktop: backdrop-filter active ('+cs.bf.slice(0,40)+')');
  ok(cs.sw<=cs.cw+1,'desktop: no horizontal overflow in bar');
  ok(await bar.locator('.mp-seek .clock').first().isVisible(),'desktop: clocks visible');
  ok(await bar.locator('.mp-float').isVisible(),'desktop: float button visible');
  await p.screenshot({path:'gp-desktop-bar.png'});
  // pop-out from the bar
  await bar.locator('.mp-float').click();await p.waitForTimeout(600);
  const fl=p.getByTestId('np-floating');
  ok(await fl.isVisible(),'float: window opens from bar');
  ok(await p.getByTestId('np-scrim').count()===0,'float: no dimming scrim');
  ok(await inView(p,fl),'float: inside viewport');
  await p.screenshot({path:'gp-desktop-float.png'});
  // chat behind stays usable
  await p.locator('textarea').first().click();await p.keyboard.type('hello behind');
  ok((await p.locator('textarea').first().inputValue())==='hello behind','float: chat still typable');
  // drag
  const before=await fl.boundingBox();const g=await p.getByTestId('np-drag').boundingBox();
  await p.mouse.move(g.x+g.width/2,g.y+g.height/2);await p.mouse.down();await p.mouse.move(g.x+g.width/2-300,g.y+g.height/2-200,{steps:8});await p.mouse.up();await p.waitForTimeout(300);
  const after=await fl.boundingBox();
  ok(Math.abs(after.x-(before.x-300))<4&&Math.abs(after.y-(before.y-200))<4,'float: dragged by mouse ('+Math.round(after.x-before.x)+','+Math.round(after.y-before.y)+')');
  await p.mouse.move(g.x,g.y);await p.mouse.down();await p.mouse.move(-500,-500,{steps:5});await p.mouse.up();await p.waitForTimeout(200);
  ok(await inView(p,fl),'float: clamped inside viewport when dragged away');
  // keyboard move
  await p.getByTestId('np-drag').focus();const k0=await fl.boundingBox();await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowDown');await p.waitForTimeout(150);const k1=await fl.boundingBox();
  ok(k1.x-k0.x===16&&k1.y-k0.y===16,'float: arrow keys move it');
  // persistence
  await p.reload();await p.waitForTimeout(6000);
  // pause/play inside float
  await p.getByTestId('player').locator('.mp-float').click().catch(()=>{});await p.waitForTimeout(500);
  await p.getByTestId('np-full').click().catch(()=>{});
  await p.screenshot({path:'gp-desktop-after-reload.png'});
  await p.context().close();
}
// ---------- desktop: full -> float -> full ----------
{
  const p=await boot({viewport:{width:1280,height:800}});
  await p.locator('.mini-open').click();await p.waitForTimeout(600);
  ok(await p.getByTestId('np-scrim').isVisible(),'full: opens');
  await p.screenshot({path:'gp-desktop-full.png'});
  await p.getByTestId('np-float').click();await p.waitForTimeout(600);
  ok(await p.getByTestId('np-scrim').count()===0&&await p.getByTestId('np-floating').isVisible(),'full -> float works');
  const playing=()=>p.evaluate(()=>{const a=document.querySelector('audio:not(.voice-el)');return a&&!a.paused;});
  ok(await playing(),'float: audio keeps playing');
  await p.getByTestId('np-floating').getByRole('button',{name:'توقف'}).click();await p.waitForTimeout(300);
  ok(!(await playing()),'float: pause works');
  await p.getByTestId('np-full').click();await p.waitForTimeout(500);
  ok(await p.getByTestId('np-scrim').isVisible(),'float -> full works');
  await p.keyboard.press('Escape');await p.waitForTimeout(300);
  ok(await p.getByTestId('np-scrim').count()===0,'Esc closes full');
  await p.context().close();
}
// ---------- phone ----------
{
  const p=await boot({viewport:{width:390,height:780},hasTouch:true,isMobile:true});
  const bar=p.getByTestId('player');
  ok(await bar.isVisible(),'phone: bar visible');
  const bb=await bar.boundingBox();
  ok(bb.x>=0&&bb.x+bb.width<=390,'phone: bar inside width ('+Math.round(bb.width)+')');
  const sw=await bar.evaluate(e=>[e.scrollWidth,e.clientWidth]);ok(sw[0]<=sw[1]+1,'phone: no overflow');
  for(const b of await bar.locator('.mp-b:visible').all()){const x=await b.boundingBox();ok(x.width>=40&&x.height>=40,'phone: touch target >=40px');}
  await p.screenshot({path:'gp-phone-bar.png'});
  await p.locator('.mini-open').tap();await p.waitForTimeout(600);
  await p.screenshot({path:'gp-phone-full.png'});
  await p.getByTestId('np-float').tap();await p.waitForTimeout(600);
  const fl=p.getByTestId('np-floating');ok(await inView(p,fl),'phone: float inside viewport');
  await p.screenshot({path:'gp-phone-float.png'});
  const cdp=await p.context().newCDPSession(p);const g=await p.getByTestId('np-drag').boundingBox();const x=g.x+g.width/2,y=g.y+g.height/2;const f0=await fl.boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-12*i,y:y-40*i}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(300);
  const f1=await fl.boundingBox();ok(f1.y<f0.y-150,'phone: float dragged by touch ('+Math.round(f1.y-f0.y)+')');
  await p.context().close();
}
// ---------- tiny phone ----------
{
  const p=await boot({viewport:{width:320,height:560},hasTouch:true,isMobile:true});
  const bar=p.getByTestId('player');const sw=await bar.evaluate(e=>[e.scrollWidth,e.clientWidth]);
  ok(sw[0]<=sw[1]+1,'320px: no overflow');await p.screenshot({path:'gp-320-bar.png'});
  await p.context().close();
}
await mk.close();
