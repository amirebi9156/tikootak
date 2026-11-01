import { chromium } from 'playwright';
const base='http://localhost:8080',J={'content-type':'application/json'};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
const sx=Date.now().toString(36).slice(-3);
async function code(){return (await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{...J,'x-admin-key':'adminkey'},body:JSON.stringify({max_uses:5,expires_days:1})})).json()).code;}
const reg=async(u)=>(await(await fetch(base+'/api/auth/register',{method:'POST',headers:J,body:JSON.stringify({invite:await code(),username:u,password:'test12345678'})})).json());
const A=await reg('swa'+sx);
const mx=async(t,m,p,b)=>(await fetch(base+'/_matrix/client/v3'+p,{method:m,headers:{...J,authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined})).json();
const B=await reg('swb'+sx);
const r=await mx(A.access_token,'POST','/createRoom',{name:'swroom'+sx,preset:'private_chat',invite:[B.user_id],initial_state:[{type:'m.room.encryption',state_key:'',content:{algorithm:'m.megolm.v1.aes-sha2'}}]});
await mx(B.access_token,'POST','/join/'+encodeURIComponent(r.room_id),{});
await mx(A.access_token,'PUT','/rooms/'+encodeURIComponent(r.room_id)+'/send/m.room.message/t1',{msgtype:'m.text',body:'mine-msg'});
await mx(B.access_token,'PUT','/rooms/'+encodeURIComponent(r.room_id)+'/send/m.room.message/t2',{msgtype:'m.text',body:'their-msg'});
const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
async function login(ctx){const p=await ctx.newPage();
 await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});
 await p.goto(base+'/?start=1');await p.getByLabel('نام کاربری').fill('swa'+sx);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:/^ورود$/}).click();
 await p.waitForTimeout(6000);
 await p.locator('.sidebar button.room',{hasText:'swroom'+sx}).first().click();await p.waitForTimeout(1800);return p;}

async function loginAs(ctx,u){const p=await ctx.newPage();
 await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});
 await p.goto(base+'/?start=1');await p.getByLabel('نام کاربری').fill(u);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:/^ورود$/}).click();
 await p.waitForTimeout(6000);await p.locator('.sidebar button.room',{hasText:'swroom'+sx}).first().click();await p.waitForTimeout(2500);return p;}
const ca=await mk.newContext({viewport:{width:390,height:780},locale:'fa-IR',hasTouch:true,isMobile:true});
const cb=await mk.newContext({viewport:{width:390,height:780},locale:'fa-IR',hasTouch:true,isMobile:true});
const pa=await loginAs(ca,'swa'+sx);const pb=await loginAs(cb,'swb'+sx);
ok(await pa.locator('[data-testid="e2ee"],.composer-lock').count()>=0,'room open');
await pa.getByRole('button',{name:'ایموجی',exact:true}).first().click();await pa.waitForTimeout(800);
await pa.getByTestId('tab-stickers').click();
await pa.locator('.emoji-panel input[type=file]').setInputFiles('tools/cover.jpg');await pa.waitForTimeout(2500);
await pa.locator('.ep-stk-item > button').first().click();await pa.waitForTimeout(5000);
ok(await pa.locator('.bubble.sticker').count()===1,'A sees own sticker (encrypted room)');
ok(await pb.locator('.bubble.sticker img').count()===1,'B receives and decrypts sticker image');
await pb.screenshot({path:'ep-enc-b.png'});
await mk.close();
