import { chromium } from 'playwright';
const base='http://localhost:8080',J={'content-type':'application/json'};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
const sx=Date.now().toString(36).slice(-3);
async function code(){return (await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{...J,'x-admin-key':'adminkey'},body:JSON.stringify({max_uses:5,expires_days:1})})).json()).code;}
const reg=async(u)=>(await(await fetch(base+'/api/auth/register',{method:'POST',headers:J,body:JSON.stringify({invite:await code(),username:u,password:'test12345678'})})).json());
const A=await reg('nta'+sx), B=await reg('ntb'+sx);
const mx=async(t,m,p,b)=>{const r=await fetch(base+'/_matrix/client/v3'+p,{method:m,headers:{...J,authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined});return r.json();};
const room=await mx(B.access_token,'POST','/createRoom',{is_direct:true,invite:[A.user_id],preset:'trusted_private_chat',name:'dmroom'});
await mx(A.access_token,'POST','/join/'+encodeURIComponent(room.room_id),{});
let n=0;const send=(t)=>mx(B.access_token,'PUT',`/rooms/${encodeURIComponent(room.room_id)}/send/m.room.message/${Date.now()}${n++}`,{msgtype:'m.text',body:t});
const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const c=await mk.newContext({viewport:{width:1280,height:800},locale:'fa-IR',permissions:['notifications']});
const p=await c.newPage();p.on('console',m=>{if(/NDBG/.test(m.text()))console.log(m.text())});
await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}
  window.__notes=[];
  const rec=(t,o)=>window.__notes.push({t,b:o&&o.body,tag:o&&o.tag});
  ServiceWorkerRegistration.prototype.showNotification=function(t,o){rec(t,o);return Promise.resolve();};
  const N=window.Notification; class FakeN{constructor(t,o){rec(t,o);} static get permission(){return 'granted';} static requestPermission(){return Promise.resolve('granted');} close(){}}
  window.Notification=FakeN;});
await p.goto(base);await p.getByRole('tab',{name:'ورود'}).click().catch(()=>{});
await p.getByLabel('نام کاربری').fill('nta'+sx);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:/^ورود$/}).click();
await p.waitForTimeout(5000);
// settings → notifications
await p.getByTestId('menu-btn').click();
await p.getByTestId('drawer-settings').click().catch(async()=>{await p.getByText('تنظیمات').first().click();});
await p.getByTestId('set-notify').click();
ok(await p.getByTestId('sw-notify').isVisible(),'notify switch visible');
ok(!(await p.getByTestId('sw-notify').isChecked()),'default off');
await send('before enable');await p.waitForTimeout(2500);
ok((await p.evaluate(()=>window.__notes.length))===0,'no notification while switch off');
await p.getByTestId('sw-notify').check();await p.waitForTimeout(500);
ok(await p.getByTestId('sw-notify').isChecked(),'switch on after click');
await p.getByRole('button',{name:'بازگشت'}).first().click();
await p.waitForTimeout(500);
await send('hello from B');await p.waitForTimeout(3000);
let notes=await p.evaluate(()=>window.__notes);console.log(JSON.stringify(notes));
ok(notes.length===1&&/hello from B$/.test(notes[0].b)&&notes[0].tag===room.room_id,'notification with text and room tag');
ok(/^\(1\) TIKOOTAK/.test(await p.title())||/^\(\d+\) TIKOOTAK/.test(await p.title()),'tab title has unread count: '+await p.title());
await p.getByTestId('sw-notify').count();
// own message / rate limit
await send('second quickly');await p.waitForTimeout(400);
// open the room → no notification while viewing
await p.evaluate(()=>{window.__notes.length=0;});
await p.getByText('ntb'+sx).first().click().catch(()=>{});await p.waitForTimeout(1500);
await send('while viewing');await p.waitForTimeout(2500);
ok((await p.evaluate(()=>window.__notes.length))===0,'no notification for the open, focused chat');
// mute room
await mx(A.access_token,'PUT',`/pushrules/global/room/${encodeURIComponent(room.room_id)}`,{actions:['dont_notify']});
await p.keyboard.press('Escape');
await p.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});window.__notes.length=0;});
await p.waitForTimeout(1500);
await send('muted msg');await p.waitForTimeout(3000);
ok((await p.evaluate(()=>window.__notes.length))===0,'muted room gives no notification');
await mx(A.access_token,'DELETE',`/pushrules/global/room/${encodeURIComponent(room.room_id)}`);
await p.waitForTimeout(1500);
console.log('rules',JSON.stringify((await mx(A.access_token,'GET','/pushrules/')).global.room));
await send('unmuted again');await p.waitForTimeout(3000);
notes=await p.evaluate(()=>window.__notes);console.log(JSON.stringify(notes));
ok(notes.some(x=>/unmuted again$/.test(x.b)),'notification again when hidden tab and unmuted');
await mk.close();
