// Phone: keyboard <-> emoji/sticker panel switching is stable (no jumps), sticker grid is tidy. Keyboard is simulated by shrinking the viewport.
import { chromium } from 'playwright';
const base='http://localhost:8080',J={'content-type':'application/json'};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
const sx=Date.now().toString(36).slice(-3);
async function code(){return (await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{...J,'x-admin-key':'adminkey'},body:JSON.stringify({max_uses:5,expires_days:1})})).json()).code;}
const reg=async(u)=>(await(await fetch(base+'/api/auth/register',{method:'POST',headers:J,body:JSON.stringify({invite:await code(),username:u,password:'test12345678'})})).json());
const A=await reg('sda'+sx);
const mx=async(t,m,p,b)=>(await fetch(base+'/_matrix/client/v3'+p,{method:m,headers:{...J,authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined})).json();
const r=await mx(A.access_token,'POST','/createRoom',{name:'sdroom'+sx,preset:'private_chat'});
for(let i=0;i<12;i++)await mx(A.access_token,'PUT','/rooms/'+encodeURIComponent(r.room_id)+'/send/m.room.message/m'+i,{msgtype:'m.text',body:'پیام '+i});
const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const c=await mk.newContext({viewport:{width:390,height:780},locale:'fa-IR',hasTouch:true,isMobile:true});const p=await c.newPage();
await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});
await p.goto(base+'/?start=1');await p.getByLabel('نام کاربری').fill('sda'+sx);await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:/^ورود$/}).click();
await p.waitForTimeout(6000);
await p.locator('.sidebar button.room',{hasText:'sdroom'+sx}).first().click();await p.waitForTimeout(1500);
const eb=p.getByRole('button',{name:'ایموجی',exact:true}).first();
const ta=p.locator('textarea').first();
const comp=()=>p.locator('form.composer').evaluate(e=>Math.round(e.getBoundingClientRect().bottom));
const dock=()=>p.locator('.emoji-dock').evaluate(e=>Math.round(e.getBoundingClientRect().height));
const kb=async(h)=>{await p.setViewportSize({width:390,height:h});await p.waitForTimeout(120);};
const rec=()=>p.evaluate(()=>{window.__y=[];const f=()=>{const e=document.querySelector('form.composer');if(e)window.__y.push(Math.round(e.getBoundingClientRect().bottom));window.__raf=requestAnimationFrame(f)};f();});
const stop=async()=>{const ys=await p.evaluate(()=>{cancelAnimationFrame(window.__raf);return window.__y});return ys;};

// --- sticker grid with odd-shaped images ---
await ta.tap();await p.waitForTimeout(300);await eb.tap();await p.waitForTimeout(800);
await p.getByTestId('tab-stickers').tap();await p.waitForTimeout(400);
const files=['s1.png','s2.png','s3.png','s4.png','s1.png','s2.png','s3.png','s4.png','s1.png'];
for(const f of files){await p.locator('.emoji-panel input[type=file]').setInputFiles(f);await p.waitForTimeout(700);}
await p.waitForTimeout(1500);
const cells=await p.locator('.ep-stk > *').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return [Math.round(b.width),Math.round(b.height),Math.round(b.x),Math.round(b.y)]}));
console.log('cells',JSON.stringify(cells.slice(0,6)));
ok(cells.length>=9,'stickers added ('+(cells.length-1)+')');
ok(cells.every(c=>Math.abs(c[0]-c[1])<=1),'all sticker cells are square');
ok(new Set(cells.map(c=>c[0])).size===1,'all sticker cells have the same size');
const pb=await p.locator('.emoji-panel').boundingBox();
ok(cells.every(c=>c[2]>=pb.x-1&&c[2]+c[0]<=pb.x+pb.width+1),'cells inside panel horizontally');
ok(await p.locator('.ep-st').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'no horizontal scroll in sticker tab');
await p.screenshot({path:'sd-stickers.png'});
await p.getByTestId('tab-stickers').tap();
await p.screenshot({path:'sd-stickers2.png'});
// close the panel cleanly
await eb.tap();await p.waitForTimeout(900);
await p.setViewportSize({width:390,height:780});await p.waitForTimeout(600);

// --- keyboard <-> panel stability ---
ok(await dock()<2,'start: dock closed');
const y0=await comp();
await ta.tap();await p.waitForTimeout(300);
await kb(480);await p.waitForTimeout(400);                       // keyboard up
const yKb=await comp();
await rec();
await eb.tap();                                                  // keyboard -> panel
await p.waitForTimeout(80);await kb(780);await p.waitForTimeout(900); // keyboard slides away
let ys=await stop();
const yPanel=await comp();
console.log('kb->panel composer y:',yKb,'->',yPanel,' samples',ys.length,'range',Math.min(...ys),Math.max(...ys));
ok(Math.max(...ys)-Math.min(...ys)<=6,'kb->panel: composer does not jump ('+(Math.max(...ys)-Math.min(...ys))+'px)');
ok(Math.abs(yPanel-yKb)<=4,'kb->panel: composer ends where it was');
ok(await dock()>240,'kb->panel: panel is open ('+await dock()+'px)');
ok(await p.evaluate(()=>document.querySelector('textarea').inputMode==='none'),'kb->panel: virtual keyboard suppressed (inputmode=none)');
await p.screenshot({path:'sd-panel.png'});
await rec();
await eb.tap();                                                  // panel -> keyboard
await p.waitForTimeout(120);await kb(480);await p.waitForTimeout(900);
ys=await stop();
const yBack=await comp();
console.log('panel->kb composer y:',yPanel,'->',yBack,'range',Math.min(...ys),Math.max(...ys));
ok(Math.max(...ys)-Math.min(...ys)<=6,'panel->kb: composer does not jump ('+(Math.max(...ys)-Math.min(...ys))+'px)');
ok(Math.abs(yBack-yKb)<=4,'panel->kb: composer back at keyboard position');
ok(await dock()<2,'panel->kb: panel collapsed');
ok(await p.evaluate(()=>document.querySelector('textarea').inputMode!=='none'),'panel->kb: keyboard allowed again');
// tap the field while the panel is open
await eb.tap();await p.waitForTimeout(100);await kb(780);await p.waitForTimeout(800);
ok(await dock()>240,'reopen panel');
await rec();await ta.tap();await p.waitForTimeout(120);await kb(480);await p.waitForTimeout(900);ys=await stop();
ok(Math.max(...ys)-Math.min(...ys)<=6,'tap field: composer does not jump ('+(Math.max(...ys)-Math.min(...ys))+'px)');
ok(await dock()<2,'tap field: panel collapsed, keyboard back');
// without a keyboard: plain slide up / down, and unlocked afterwards
await kb(780);await p.evaluate(()=>document.activeElement?.blur());await p.waitForTimeout(500);
await eb.tap();await p.waitForTimeout(700);ok(await dock()>240,'no keyboard: panel opens');
await eb.tap();await p.waitForTimeout(900);await kb(780);await p.waitForTimeout(500);
ok(await dock()<2,'no keyboard: panel closes (dock '+await dock()+')');
ok(await p.evaluate(()=>!document.documentElement.classList.contains('vp-lock')),'viewport lock released');
ok(await p.evaluate(()=>getComputedStyle(document.querySelector('.shell')).height)===await p.evaluate(()=>innerHeight+'px'),'shell height = viewport');
await mk.close();
