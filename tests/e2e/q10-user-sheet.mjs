// In-chat user profile sheet (Telegram style): tap sender avatar/name, members tab in chat info, desktop + phone.
import { chromium } from 'playwright';
const base='http://localhost:8080',J={'content-type':'application/json'};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
const sx=Date.now().toString(36).slice(-3);
async function code(){return (await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{...J,'x-admin-key':'adminkey'},body:JSON.stringify({max_uses:5,expires_days:1})})).json()).code;}
const reg=async(u)=>(await(await fetch(base+'/api/auth/register',{method:'POST',headers:J,body:JSON.stringify({invite:await code(),username:u,password:'test12345678'})})).json());
const mx=async(t,m,p,b)=>(await fetch(base+'/_matrix/client/v3'+p,{method:m,headers:{...J,authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined})).json();
const A=await reg('usa'+sx),B=await reg('usb'+sx);
const r=await mx(A.access_token,'POST','/createRoom',{name:'usroom'+sx,preset:'private_chat',invite:[B.user_id]});
await mx(B.access_token,'POST','/join/'+encodeURIComponent(r.room_id),{});
for(let i=0;i<3;i++)await mx(B.access_token,'PUT','/rooms/'+encodeURIComponent(r.room_id)+'/send/m.room.message/b'+i,{msgtype:'m.text',body:'hello from B '+i});
const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
async function run(tag,vp,mobile){
  const c=await mk.newContext({viewport:vp,locale:'fa-IR',hasTouch:mobile,isMobile:mobile});const p=await c.newPage();
  await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});
  await p.goto(base+'/?start=1');await p.getByLabel('نام کاربری').fill('usa'+sx);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:/^ورود$/}).click();
  await p.waitForTimeout(6000);
  await p.locator('.sidebar button.room',{hasText:'usroom'+sx}).first().click();await p.waitForTimeout(1500);
  const tap=l=>mobile?l.tap():l.click();
  await tap(p.getByTestId('msg-avatar').first());await p.waitForTimeout(700);
  ok(await p.getByTestId('user-sheet').isVisible(),tag+': tapping sender avatar opens the user sheet');
  const sb=await p.locator('.usheet').boundingBox();
  ok(sb.x>=-1&&sb.x+sb.width<=vp.width+1,tag+': sheet fits width');
  ok(await p.locator('.usheet .ci-act').count()>=3,tag+': sheet has actions');
  await p.screenshot({path:`us-${tag}.png`});
  await p.keyboard.press('Escape');await p.waitForTimeout(500);
  ok(!(await p.getByTestId('user-sheet').count()),tag+': Escape closes the sheet');
  await tap(p.getByTestId('msg-sender').first());await p.waitForTimeout(500);
  ok(await p.getByTestId('user-sheet').isVisible(),tag+': tapping sender name opens the sheet');
  await p.keyboard.press('Escape');await p.waitForTimeout(400);
  await tap(p.locator('.chat-avatar').first());await p.waitForTimeout(700);
  await tap(p.getByRole('tab',{name:/اعضا/}));await p.waitForTimeout(400);
  ok(await p.getByTestId('info-member').count()===2,tag+': members tab lists both members');
  await tap(p.getByTestId('info-member').first());await p.waitForTimeout(600);
  ok(await p.getByTestId('user-sheet').isVisible(),tag+': member row opens the sheet');
  await p.screenshot({path:`us-${tag}-members.png`});
  await c.close();
}
await run('phone',{width:390,height:780},true);
await run('desktop',{width:1280,height:800},false);
await mk.close();
