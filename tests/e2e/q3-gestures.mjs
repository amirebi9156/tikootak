import { chromium } from 'playwright';
const base='http://localhost:8080';
const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const inv=(await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{'content-type':'application/json','x-admin-key':'adminkey'},body:JSON.stringify({max_uses:10,expires_days:1})})).json()).code;
const sx=Date.now().toString(36).slice(-4); const aU='ali'+sx,bU='bob'+sx;
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
async function np(opts){const c=await mk.newContext({locale:'fa-IR',...opts});const p=await c.newPage();await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});p.on('pageerror',e=>console.log('pageerror',e.message));return p;}
async function signup(p,u,d){await p.goto(base);await p.getByRole('tab',{name:'ساخت حساب'}).click();await p.getByLabel('کد دعوت').fill(inv);await p.getByLabel('نام کاربری').fill(u);await p.getByLabel('نامی که دوستانت می‌بینند').fill(d);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:'ساخت حساب'}).click();await p.locator('.me-avatar-btn').waitFor();}
const A=await np({viewport:{width:1280,height:800}});await signup(A,aU,'علی');
const B=await np({viewport:{width:430,height:860},isMobile:true,hasTouch:true,deviceScaleFactor:2});await signup(B,bU,'باب');
await A.getByTestId('menu-btn').click();await A.getByTestId('drawer-group').click();
await A.getByLabel('نام',{exact:true}).fill('گروه تست');await A.getByLabel(/دعوت دوستان/).fill(bU);
const sw=A.getByTestId('sw-enc'); 
await A.getByRole('button',{name:'ساخت گفتگو'}).click();
await A.locator('.chat-title').filter({hasText:'گروه تست'}).waitFor({timeout:15000});
await B.locator('.room.invite').waitFor({timeout:20000});await B.getByRole('button',{name:'بپیوند'}).click();await B.waitForTimeout(2500);
const ta=A.locator('textarea').first();await ta.fill('سلام از علی');await ta.press('Enter');await A.waitForTimeout(1500);
await B.waitForTimeout(2500);
// mobile tap
const bub=B.locator('.msg').filter({hasText:'سلام از علی'}).first().locator('.bubble');
await bub.tap();await B.waitForTimeout(600);
const sheet=await B.locator('.ctx-layer.glass.touch .ctx-menu').count();ok(sheet===1,'mobile: single tap opens glass menu');
await B.screenshot({path:'q3-sheet.png'});
const names=await B.locator('.ctx-menu button').allInnerTexts();console.log('sheet buttons:',names.join(' | ').slice(0,300));
ok(names.some(t=>/پاسخ/.test(t)),'sheet has reply');
await B.keyboard.press('Escape');await B.waitForTimeout(300);
ok(await B.locator('.ctx-menu').count()===0,'sheet closes');
// scroll gesture should not open: simulate swipe via touch events
const box=await bub.boundingBox();
await B.touchscreen.tap(box.x+10,box.y+10);await B.waitForTimeout(500);
await B.keyboard.press('Escape');
// B reply via sheet then send
await bub.tap();await B.waitForTimeout(400);await B.locator('.ctx-menu button',{hasText:'پاسخ'}).first().click();await B.waitForTimeout(400);
const tb=B.locator('textarea').first();await tb.fill('جواب باب');await tb.press('Enter');await B.waitForTimeout(1500);
// desktop dblclick on B's message from A
await A.waitForTimeout(1500);
const bm=A.locator('.msg').filter({hasText:'جواب باب'}).first().locator('.bubble');
await A.locator('.msg').filter({hasText:'جواب باب'}).first().getByText('جواب باب',{exact:true}).dblclick();await A.waitForTimeout(700);
await A.screenshot({path:'q3-dbl.png'});
const composerArea=await A.locator('.composer, .chat').first().innerText();
const rp=await A.locator('textarea').first().evaluate(e=>e.closest('.chat')?.innerText.slice(-400));console.log('tail:',JSON.stringify(rp));ok(/باب/.test(rp.split('پیام خود')[0].slice(-120)),'desktop: double-click starts reply (quote above composer)');
// dblclick should not leave a text selection
ok((await A.evaluate(()=>String(getSelection()))).length===0,'no leftover selection');
// right click opens floating menu
await bm.click({button:'right'});await A.waitForTimeout(400);ok(await A.locator('.ctx-menu').count()===1&&await A.locator('.ctx-menu.sheet').count()===0,'desktop: right-click floating menu');
await mk.close();
