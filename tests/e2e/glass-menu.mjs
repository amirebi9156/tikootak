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
const cdp=await c.newCDPSession(p);
for (const [name,tx] of [['their',0],['mine',1]]) {
 const bb=await p.locator('.msg:has-text("'+(name==='their'?'their-msg':'mine-msg')+'") .bubble').first().boundingBox();
 const x=bb.x+bb.width/2,y=bb.y+bb.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(700);
 const pill=await p.locator('.ctx-pill').boundingBox();const card=await p.locator('.ctx-menu').boundingBox();
 await p.screenshot({path:'cm-'+name+'.png'});
 ok(pill&&card,'menu parts shown '+name);
 ok(pill.y+pill.height<=y&&card.y>=y,'pill above tap, card below tap '+name+` (pill ${Math.round(pill.y)}-${Math.round(pill.y+pill.height)}, y ${Math.round(y)}, card ${Math.round(card.y)})`);
 ok(card.x>=0&&card.x+card.width<=390&&pill.x>=0&&pill.x+pill.width<=390,'inside viewport '+name);
 ok(await p.locator('.ctx-sheet, .ctx-grip').count()===0,'no bottom sheet');
 // react via pill
 if(name==='mine'){await p.locator('.ctx-pill button').first().click();await p.waitForTimeout(500);ok(await p.locator('.ctx-menu').count()===0,'reaction closes menu');}
 else {await p.mouse.click(5,5);await p.waitForTimeout(500);ok(await p.locator('.ctx-menu').count()===0,'outside tap closes menu');}
}
await mk.close();
