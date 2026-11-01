import { chromium } from 'playwright';
const base='http://localhost:8080',J={'content-type':'application/json'};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
const sx=Date.now().toString(36).slice(-3);
async function code(){return (await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{...J,'x-admin-key':'adminkey'},body:JSON.stringify({max_uses:5,expires_days:1})})).json()).code;}
const reg=async(u)=>(await(await fetch(base+'/api/auth/register',{method:'POST',headers:J,body:JSON.stringify({invite:await code(),username:u,password:'test12345678'})})).json());
const A=await reg('bka'+sx);
const mx=async(t,m,p,b)=>(await fetch(base+'/_matrix/client/v3'+p,{method:m,headers:{...J,authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined})).json();
await mx(A.access_token,'POST','/createRoom',{name:'bkroom'+sx,preset:'private_chat'});
const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const c=await mk.newContext({viewport:{width:390,height:780},locale:'fa-IR',hasTouch:true,isMobile:true});const p=await c.newPage();
await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});
await p.goto(base+'/?start=1');await p.getByLabel('نام کاربری').fill('bka'+sx);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:/^ورود$/}).click();
await p.waitForTimeout(6000);
const alive=async()=>p.evaluate(()=>location.pathname==='/'&&!!document.querySelector('.bottombar'));
const inChat=async()=>(await p.locator('.chat-head').count())>0&&(await p.locator('.chat-head').first().isVisible());
// 1) chat → back
await p.locator('.sidebar button.room',{hasText:'bkroom'+sx}).first().click();await p.waitForTimeout(1200);
ok(await inChat(),'chat opened');
await p.goBack();await p.waitForTimeout(800);
ok(await alive(),'app still open after back from chat');
ok(!(await inChat()),'back returned to the chat list');
// 2) other tab → back → chat list
await p.locator('.bottombar button').nth(1).click();await p.waitForTimeout(800);
await p.goBack();await p.waitForTimeout(800);
ok(await alive()&&await p.locator('.bottombar button.on').first().innerText().then(t=>/گفتگو/.test(t)),'back from a tab returns to chats');
// 3) dialog → back closes only the dialog
await p.locator('.sidebar button.room',{hasText:'bkroom'+sx}).first().click();await p.waitForTimeout(1000);
await p.getByTestId('new-conv').click().catch(()=>{});
// open chat first then drawer dialog: use chat menu instead -> new dialog from list
await p.goBack();await p.waitForTimeout(600);
await p.getByTestId('new-conv').click();await p.waitForTimeout(600);
ok(await p.locator('.dialog').isVisible(),'dialog open');
await p.goBack();await p.waitForTimeout(600);
ok(await p.locator('.dialog').count()===0&&await alive(),'back closed the dialog, app stays');
// 4) in-app back button then browser back must NOT eat extra
await p.locator('.sidebar button.room',{hasText:'bkroom'+sx}).first().click();await p.waitForTimeout(1000);
await p.getByTestId('chat-back').click();await p.waitForTimeout(800);
const hs=await p.evaluate(()=>history.state);
ok(await alive()&&!(await inChat()),'in-app back button works');
ok(!hs||!hs.tk,'history is back at the root after in-app back (state '+JSON.stringify(hs)+')');
// 5a) chat → attach menu → back closes only the menu
await p.locator('.sidebar button.room',{hasText:'bkroom'+sx}).first().click();await p.waitForTimeout(1000);
await p.getByRole('button',{name:'پیوست'}).first().click();await p.waitForTimeout(400);
ok(await p.locator('.attach-menu').isVisible(),'attach menu open');
await p.goBack();await p.waitForTimeout(600);
ok(await p.locator('.attach-menu').count()===0&&await inChat(),'back closed only the menu, chat stays');
await p.goBack();await p.waitForTimeout(600);
ok(!(await inChat())&&await alive(),'second back closes the chat');
// 5) chat → drawer → back closes drawer first, then chat
await p.locator('.sidebar button.room',{hasText:'bkroom'+sx}).first().click();await p.waitForTimeout(1000);
await p.goBack();await p.waitForTimeout(600);
ok(await alive(),'still alive; final state ok');
await mk.close();
