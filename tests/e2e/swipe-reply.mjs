import { chromium } from 'playwright';
const base='http://localhost:8080',J={'content-type':'application/json'};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
const sx=Date.now().toString(36).slice(-3);
async function code(){return (await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{...J,'x-admin-key':'adminkey'},body:JSON.stringify({max_uses:5,expires_days:1})})).json()).code;}
const reg=async(u)=>(await(await fetch(base+'/api/auth/register',{method:'POST',headers:J,body:JSON.stringify({invite:await code(),username:u,password:'test12345678'})})).json());
const A=await reg('swa'+sx);
const mx=async(t,m,p,b)=>(await fetch(base+'/_matrix/client/v3'+p,{method:m,headers:{...J,authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined})).json();
const B=await reg('swb'+sx);
const r=await mx(A.access_token,'POST','/createRoom',{name:'swroom'+sx,preset:'private_chat',invite:[B.user_id]});
await mx(B.access_token,'POST','/join/'+encodeURIComponent(r.room_id),{});
await mx(A.access_token,'PUT','/rooms/'+encodeURIComponent(r.room_id)+'/send/m.room.message/t1',{msgtype:'m.text',body:'mine-msg'});
await mx(B.access_token,'PUT','/rooms/'+encodeURIComponent(r.room_id)+'/send/m.room.message/t2',{msgtype:'m.text',body:'their-msg'});
const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
async function login(ctx){const p=await ctx.newPage();
 await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});
 await p.goto(base+'/?start=1');await p.getByLabel('نام کاربری').fill('swa'+sx);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:/^ورود$/}).click();
 await p.waitForTimeout(6000);
 await p.locator('.sidebar button.room',{hasText:'swroom'+sx}).first().click();await p.waitForTimeout(1800);return p;}
const hasReply=p=>p.locator('[data-testid="ctxbar"]').count();
// touch swipe via CDP
async function touchSwipe(p,sel,dx,dy=0){
 const b=await p.locator(sel).first().boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;
 const cdp=await p.context().newCDPSession(p);
 const pt=(xx,yy)=>[{x:xx,y:yy}];
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pt(x,y)});
 for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pt(x+dx*i/10,y+dy*i/10)});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await p.waitForTimeout(500);}
// mobile
{const c=await mk.newContext({viewport:{width:390,height:780},locale:'fa-IR',hasTouch:true,isMobile:true});const p=await login(c);
 const row=(t)=>`.msg:has-text("${t}")`;
 await touchSwipe(p,row('their-msg'),-110);
 ok(await hasReply(p)>0,'mobile: swipe left on their message sets reply');
 await p.keyboard.press('Escape');await p.evaluate(()=>{});
 const before=await hasReply(p);
 await touchSwipe(p,row('mine-msg'),-110);
 ok(await hasReply(p)>0,'mobile: swipe left on own message sets reply');
 const txt=await p.locator('[data-testid="ctxbar"]').first().innerText().catch(()=> '');
 ok(/mine-msg/.test(txt),'reply targets own message ('+txt.slice(0,30)+')');
 // short swipe must not reply
 await p.locator(`[data-testid="ctxbar"] button`).first().evaluate(b=>b.click()).catch(e=>console.log("closeerr",e.message.slice(0,80)));await p.waitForTimeout(300);console.log("after close",await p.locator(`[data-testid="ctxbar"]`).count());
 await touchSwipe(p,row('their-msg'),-30);
 const n1=await p.locator('[data-testid="ctxbar"]').count();
 ok(n1===0,'mobile: short swipe does not reply ('+n1+')');
 // vertical drag does not reply
 await touchSwipe(p,row('their-msg'),-10,-120);
 ok(await p.locator('[data-testid="ctxbar"]').count()===0,'mobile: vertical drag does not reply');
 // rightwards does not reply
 await touchSwipe(p,row('their-msg'),120);
 ok(await p.locator('[data-testid="ctxbar"]').count()===0,'mobile: rightward swipe does not reply');
 await c.close();}
// mobile: empty-space tap and swipe
{const c=await mk.newContext({viewport:{width:390,height:780},locale:'fa-IR',hasTouch:true,isMobile:true});const p=await login(c);
 const bb=await p.locator('.msg:has-text("their-msg") .bubble').first().boundingBox();
 const tl=await p.locator('.timeline').boundingBox();
 const ex=(bb.x+bb.width/2<tl.x+tl.width/2)?tl.x+tl.width-8:tl.x+8; const ey=bb.y+bb.height/2;
 const cdp=await c.newCDPSession(p);
 const tap=async()=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:ex,y:ey}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(500);};
 const sw=async(dx)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:ex,y:ey}]});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:ex+dx*i/10,y:ey}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(500);};
 await sw(-110);
 ok(await p.locator('[data-testid="ctxbar"]').count()>0,'mobile: swipe starting on empty space replies');
 await tap();
 ok(await p.locator('[role="menu"]').count()>0,'mobile: tap on empty space beside message opens menu');
 await p.keyboard.press("Escape");await p.waitForTimeout(400);console.log("menu after esc",await p.locator("[role=menu]").count());
 await p.evaluate(()=>{});
 await c.close();}
// desktop
{const c=await mk.newContext({viewport:{width:1280,height:800},locale:'fa-IR'});const p=await login(c);
 const b=await p.locator('.msg:has-text("their-msg") .bubble').first().boundingBox();
 await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();
 for(let i=1;i<=10;i++)await p.mouse.move(b.x+b.width/2-i*12,b.y+b.height/2);
 await p.mouse.up();await p.waitForTimeout(500);
 ok(await p.locator('[data-testid="ctxbar"]').count()>0,'desktop: mouse drag left replies');
 await p.locator('[data-testid="ctxbar"] button').first().click().catch(()=>{});await p.waitForTimeout(300);
 // wheel horizontal
 await p.mouse.move(b.x+b.width/2,b.y+b.height/2);
 for(let i=0;i<5;i++){await p.mouse.wheel(40,0);await p.waitForTimeout(30);}
 await p.waitForTimeout(400);
 ok(await p.locator('[data-testid="ctxbar"]').count()>0,'desktop: trackpad horizontal scroll replies');
 await c.close();}
await mk.close();
