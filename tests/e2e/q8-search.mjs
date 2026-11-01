import { chromium } from 'playwright';
const base='http://localhost:8080',J={'content-type':'application/json'};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
const sx=Date.now().toString(36).slice(-3);
async function inviteCode(){return (await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{...J,'x-admin-key':'adminkey'},body:JSON.stringify({max_uses:10,expires_days:1})})).json()).code;}
const inv=await inviteCode();
const reg=async(u)=>(await(await fetch(base+'/api/auth/register',{method:'POST',headers:J,body:JSON.stringify({invite:inv,username:u,password:'Zx9!kLm2pQ7w'})})).json());
const me=await reg('qme'+sx); await reg('zara'+sx); await reg('zoya'+sx); await reg('mzar'+sx);
const H={authorization:'Bearer '+me.access_token};
let r=await fetch(base+'/api/people/suggest?q=z',{headers:H});let j=await r.json();console.log(j.users.map(u=>u.user_id).join(' '));
const mk=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
for (const [label,vp] of [['desktop',{width:1280,height:800}],['mobile',{width:390,height:780}]]) {
const c=await mk.newContext({viewport:vp,locale:'fa-IR'});const p=await c.newPage();await p.addInitScript(()=>{try{localStorage.setItem('tikotak.onboarded','1')}catch{}});
await p.goto(base);await p.getByRole('tab',{name:'ساخت حساب'}).click();await p.getByLabel('کد دعوت').fill(await inviteCode());await p.getByLabel('نام کاربری').fill('ui'+label[0]+sx);await p.getByLabel('نامی که دوستانت می‌بینند').fill('یو‌آی');await p.getByLabel('رمز عبور').fill('test12345678');await p.getByRole('button',{name:'ساخت حساب'}).click();await p.waitForTimeout(3000);
p.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,300)));
await p.waitForTimeout(2500);
ok(await p.locator('.compose-fab').isVisible()===false,label+': floating button gone');
ok(await p.getByTestId('new-conv').isVisible(),label+': fixed create button visible');
await p.screenshot({path:'q8-pre-'+label+'.png'});
await p.getByTestId('list-search').fill('zara'+sx);await p.waitForTimeout(1200);
await p.screenshot({path:'q8-'+label+'.png'});
ok(await p.getByTestId('find-people').getByText('zara'+sx).count()>0,label+': person listed under search');
ok(!(await p.getByTestId('list-search').inputValue()).includes('@'),label+': no @id in field');
await p.getByTestId('find-people').getByText('zara'+sx).first().click();await p.waitForTimeout(1200);
ok(await p.getByRole('button',{name:'پیام'}).first().isVisible(),label+': profile with Message button');
await p.screenshot({path:'q8-prof-'+label+'.png'});
await p.getByRole('button',{name:'پیام'}).first().click();await p.waitForTimeout(2500);
ok(await p.locator('.chat-head').isVisible(),label+': DM chat opened');
await c.close();
}
await mk.close();
