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

const adm=(b)=>fetch(base+'/api/admin/upload-policy',{method:'POST',headers:{...J,'x-admin-key':'adminkey'},body:JSON.stringify(b)}).then(r=>r.json());
await adm({small_kb:20,kinds:{music:{mode:'none'},voice:{mode:'none'},file:{mode:'users',users:['nobody']},image:{mode:'all'}}});
const c=await mk.newContext({viewport:{width:390,height:780},locale:'fa-IR',hasTouch:true,isMobile:true});const p=await login(c);
await p.getByRole('button',{name:'پیوست'}).first().click();await p.waitForTimeout(400);
const dis=async(t)=>await p.locator('.attach-menu button',{hasText:t}).first().isDisabled();
ok(await dis('موزیک'),'music disabled in attach menu');
ok(await dis('فایل'),'file disabled (not in users list)');
ok(!(await dis('تصویر')),'image still enabled');
await p.keyboard.press('Escape');
ok(await p.locator('.send.mic').first().isDisabled().catch(()=>false),'voice mic disabled');
// send a 100KB image through UI (allowed) 
await p.screenshot({path:'up-ui.png'});
// admin page
const a=await mk.newContext({viewport:{width:1100,height:800},locale:'fa-IR'});const ap=await a.newPage();
await ap.goto(base+'/admin.html');await ap.locator('#key').fill('adminkey');await ap.locator('#go').click();await ap.waitForTimeout(1500);
await ap.locator('#tabs button',{hasText:'ارسال فایل'}).click();await ap.waitForTimeout(800);
ok(await ap.locator('select').count()===5,'admin tab shows 5 category selects');
const sel=ap.locator('select').nth(3);await sel.selectOption('users');
await ap.locator('textarea').nth(3).fill('alice, @bob:localhost');
await ap.getByRole('button',{name:'ذخیره'}).click();await ap.waitForTimeout(800);
const pol=await (await fetch(base+'/api/admin/upload-policy',{headers:{'x-admin-key':'adminkey'}})).json();
ok(pol.kinds.music.mode==='users'&&pol.kinds.music.users.includes('@alice:localhost')&&pol.kinds.music.users.includes('@bob:localhost'),'admin UI saved policy '+JSON.stringify(pol.kinds.music));
await ap.screenshot({path:'up-admin.png'});
await adm({small_kb:512,kinds:{image:{mode:'all'},video:{mode:'all'},voice:{mode:'all'},music:{mode:'all'},file:{mode:'all'}}});
await mk.close();
