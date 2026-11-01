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

const c=await mk.newContext({viewport:{width:390,height:780},locale:'fa-IR',hasTouch:true,isMobile:true});const p=await login(c);
const dock=()=>p.locator('.emoji-dock').evaluate(e=>e.getBoundingClientRect().height);
const foc=()=>p.evaluate(()=>document.activeElement?.tagName==='TEXTAREA');
const ta=p.locator('textarea').first();
await ta.tap();await p.waitForTimeout(300);ok(await foc(),'textarea focused (keyboard up)');
const eb=p.getByRole('button',{name:'ایموجی',exact:true}).first();
await eb.tap();await p.waitForTimeout(700);
ok(await dock()>240,'tap emoji: dock slides up ('+Math.round(await dock())+'px)');
ok(!(await foc()),'tap emoji: keyboard dismissed (textarea blurred)');
await p.screenshot({path:'dock-open.png'});
await eb.tap();await p.waitForTimeout(700);
ok(await dock()<2,'tap emoji again: dock collapses');
ok(await foc(),'tap emoji again: keyboard returns (textarea focused)');
await eb.tap();await p.waitForTimeout(600);ok(await dock()>240,'reopen');
await ta.tap();await p.waitForTimeout(700);
ok(await dock()<2&&await foc(),'tap text field while open: dock closes, keyboard returns');
await eb.tap();await p.waitForTimeout(600);
await p.getByTestId('tab-stickers').tap();await p.waitForTimeout(400);
await p.screenshot({path:'dock-st.png'});await p.locator('.ep-big button').first().tap();await p.waitForTimeout(1200);
ok(await dock()<2,'sending a big emoji closes the dock');
await mk.close();
