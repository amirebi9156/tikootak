import { chromium } from 'playwright';
const base='http://localhost:8080';
const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const inv=(await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{'content-type':'application/json','x-admin-key':'adminkey'},body:JSON.stringify({max_uses:10,expires_days:1})})).json()).code;
const sx=Date.now().toString(36).slice(-4); const aU='ali'+sx,bU='bob'+sx;
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
async function np(){const c=await mk.newContext({viewport:{width:1280,height:800},locale:'fa-IR'});const p=await c.newPage();await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});p.on('pageerror',e=>console.log('pageerror',e.message));return p;}
async function signup(p,u,d){await p.goto(base);await p.getByRole('tab',{name:'ساخت حساب'}).click();await p.getByLabel('کد دعوت').fill(inv);await p.getByLabel('نام کاربری').fill(u);await p.getByLabel('نامی که دوستانت می‌بینند').fill(d);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:'ساخت حساب'}).click();await p.locator('.me-avatar-btn').waitFor();}
const A=await np();await signup(A,aU,'ادمین‌علی');const B=await np();await signup(B,bU,'باب');
await A.getByTestId('menu-btn').click();await A.getByTestId('drawer-channel').click();
await A.getByLabel('نام',{exact:true}).fill('کانال تست');await A.getByLabel(/دعوت دوستان/).fill(bU);await A.getByRole('button',{name:'ساخت گفتگو'}).click();
await A.locator('.chat-title').filter({hasText:'کانال تست'}).waitFor({timeout:15000});
await B.locator('.room.invite').waitFor({timeout:20000});await B.locator('.room.invite').click();
await B.getByRole('button',{name:'بپیوند'}).first().click().catch(()=>{});
await B.waitForTimeout(2500);
const ta=A.locator('textarea').first();await ta.fill('پست اول کانال');await ta.press('Enter');
await A.waitForTimeout(1500);

await B.locator('.room',{hasText:'کانال تست'}).first().click();await B.waitForTimeout(2500);
async function drag(p,sel,emptyX){const b=await p.locator(sel).first().boundingBox();const y=b.y+b.height/2;const tl=await p.locator('.timeline').boundingBox();
 const x0=emptyX?(emptyX==='far'?tl.x+tl.width*0.15:b.x+b.width+30):b.x+b.width/2;
 await p.mouse.move(x0,y);await p.mouse.down();for(let i=1;i<=10;i++)await p.mouse.move(x0-i*12,y);await p.mouse.up();await p.waitForTimeout(500);return {tl,b,y};}
const msgSel='.msg:has-text("پست اول کانال") .bubble';
// B (member): swipe on empty space -> forward dialog, no reply bar
const i0=await B.locator(msgSel).first().boundingBox();const tl=await B.locator('.timeline').boundingBox();
const emptyX=(i0.x+i0.width/2<tl.x+tl.width/2)?tl.x+tl.width-30:tl.x+30;
await B.mouse.move(emptyX,i0.y+i0.height/2);await B.mouse.down();for(let i=1;i<=10;i++)await B.mouse.move(emptyX-i*12,i0.y+i0.height/2);await B.mouse.up();await B.waitForTimeout(600);
ok(await B.locator('.dialog').isVisible().catch(()=>false),'channel member: swipe on empty space opens forward');
ok(await B.locator('[data-testid="ctxbar"]').count()===0,'channel member: no reply bar');
await B.keyboard.press('Escape');await B.waitForTimeout(400);
// B: click on empty space -> menu, without reply
await B.mouse.click(emptyX,i0.y+i0.height/2);await B.waitForTimeout(500);
const menuTxt=await B.locator('[role="menu"]').last().innerText().catch(()=> '');
ok(/ارسال به/.test(menuTxt),'channel member: empty-space click opens menu ('+menuTxt.replace(/\n/g,'|').slice(0,50)+')');
ok(!/^پاسخ$/m.test(menuTxt),'channel member: menu has no reply');ok(!/پین/.test(menuTxt),'channel member: no pin');
await B.keyboard.press('Escape');
// A (admin): swipe -> reply
const a0=await A.locator(msgSel).first().boundingBox();const atl=await A.locator('.timeline').boundingBox();
const ax=(a0.x+a0.width/2<atl.x+atl.width/2)?atl.x+atl.width-30:atl.x+30;
await A.mouse.move(ax,a0.y+a0.height/2);await A.mouse.down();for(let i=1;i<=10;i++)await A.mouse.move(ax-i*12,a0.y+a0.height/2);await A.mouse.up();await A.waitForTimeout(600);
ok(await A.locator('[data-testid="ctxbar"]').count()>0,'channel admin: swipe on empty space replies');
await mk.close();
