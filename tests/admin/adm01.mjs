import Database from 'better-sqlite3';
// تست API ادمین/ثبت‌نام/دعوت (۳۰ بررسی). اجرا داخل کانتینر gateway یا با: GW=http://localhost:3000 ADMIN=… DOMAIN=localhost DB=… node tests/admin/adm01.mjs
// ⚠ فقط روی محیط تست! تنظیمات ثبت‌نام را موقتاً عوض می‌کند و کاربر تستی می‌سازد.
const B=process.env.GW||'http://localhost:3000', K={'x-admin-key':process.env.ADMIN||'adminkey','content-type':'application/json'};
const j=async(p,m='GET',b,h=K)=>{const r=await fetch(B+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined});return {s:r.status,d:await r.json().catch(()=>({}))}};
let ok=0,bad=0; const t=(n,c,x)=>{c?ok++:(bad++,console.log('FAIL',n,JSON.stringify(x)));};
const sfx=Math.random().toString(36).slice(2,6);
const reg=async(code,u)=>j('/api/auth/register','POST',{invite:code,username:u,password:'Zx9!kLm2pQw7',displayname:u},{'content-type':'application/json'});
let o=await j('/api/admin/overview'); t('overview',o.s===200&&o.d.disk&&Array.isArray(o.d.days),o);
// 1) kill switch
let s=await j('/api/admin/settings','POST',{registration_open:false,closed_message:'بسته'}); t('close',s.d.status.open===false,s);
let c=await j('/api/admin/invites','POST',{max_uses:5,expires_days:3});
let r=await reg(c.d.code,'a'+sfx); t('closed reg',r.s===403&&r.d.error==='registration_closed',r);
let pub=await j('/api/public/config'); t('public',pub.d.registration_open===false&&pub.d.message==='بسته',pub);
let inv=await j('/api/admin/invites'); t('code not consumed',inv.d.find(x=>x.code===c.d.code).uses===0,inv.d[0]);
await j('/api/admin/settings','POST',{registration_open:true,closed_message:''});
// daily cap
o=await j('/api/admin/overview'); await j('/api/admin/settings','POST',{daily_cap:o.d.signups_24h+1});
let a=await reg(c.d.code,'a'+sfx); t('first ok under cap',a.s===200,a);
let b2=await reg(c.d.code,'b'+sfx); t('daily cap blocks',b2.s===403&&b2.d.error==='registration_closed'&&b2.d.reason==='daily_cap',b2);
await j('/api/admin/settings','POST',{daily_cap:0});
// 2) user invites
const A='@a'+sfx+':'+(process.env.DOMAIN||'localhost');
const db=new Database(process.env.DB||'/data/gateway/gateway.db');
const auth={authorization:'Bearer '+a.d.access_token,'content-type':'application/json'};
let mine=await j('/api/invites','POST',null,auth); t('too new',mine.s===403&&mine.d.error==='invite_too_new',mine);
db.prepare('UPDATE registrations SET created_at=created_at-200000 WHERE user_id=?').run(A);
mine=await j('/api/invites','POST',null,auth); t('create code',mine.s===201&&/^[A-F0-9]{5}-[A-F0-9]{5}$/.test(mine.d.code),mine);
const b=await reg(mine.d.code,'b'+sfx); t('invitee registered',b.s===200,b);
const B2='@b'+sfx+':'+(process.env.DOMAIN||'localhost');
const bauth={authorization:'Bearer '+b.d.access_token,'content-type':'application/json'};
db.prepare('UPDATE registrations SET created_at=created_at-200000 WHERE user_id=?').run(B2);
let mine2=await j('/api/invites','POST',null,bauth); const cc=await reg(mine2.d.code,'c'+sfx); t('grandchild',cc.s===200,cc);
const C2='@c'+sfx+':'+(process.env.DOMAIN||'localhost');
let list=await j('/api/invites',"GET",null,auth); t('my invited',list.d.invited.length===1&&list.d.invited[0].user_id===B2,list.d);
// quota limit
for(let i=0;i<5;i++) mine=await j('/api/invites','POST',null,auth); t('quota',mine.s===403&&mine.d.error==='invite_limit',mine);
// 3) lineage
let d=await j('/api/admin/users/'+encodeURIComponent(C2)); t('chain',d.d.inviter_chain[0]===B2&&d.d.inviter_chain[1]===A,d.d);
d=await j('/api/admin/users/'+encodeURIComponent(A)); t('desc',d.d.descendants===2&&d.d.invitees.length===1,d.d);
let us=await j('/api/admin/users'); const ua=us.d.users.find(u=>u.user_id===A); t('users list',ua.invited===1&&us.d.users.find(u=>u.user_id===B2).inviter===A,ua);
let tree=await j('/api/admin/invites/tree'); t('tree',tree.d.nodes.length>=3,tree.s);
// 4) content then moderation + purge cascade
let up=await fetch(B+'/api/feed/posts',{method:'POST',headers:{authorization:bauth.authorization,'content-type':'image/png','x-caption':'bad'},body:await (await import('node:fs')).promises.readFile(new URL('../security/pic.png', import.meta.url))}); t('post upload',up.status===201,up.status);
let mp=await j('/api/admin/moderation/posts'); const mine_p=mp.d.posts.find(p=>p.user_id===B2); t('mod list',!!mine_p&&mine_p.inviter===A&&mine_p.url,mp.d.posts[0]);
let media=await fetch(B+mine_p.url); t('admin media',media.status===200,media.status);
let pg=await j('/api/admin/moderation/posts?user='+encodeURIComponent(B2)); t('filter user',pg.d.posts.length===1,pg.d);
// simple ban
let bn=await j('/api/admin/users/'+encodeURIComponent(C2)+'/ban','POST',{reason:'x'}); t('ban',bn.d.banned===true&&bn.d.matrix_closed===false,bn);
let ub=await j('/api/admin/users/'+encodeURIComponent(C2)+'/ban','DELETE'); t('unban',ub.d.ok,ub);
let pu=await j('/api/admin/users/'+encodeURIComponent(A)+'/purge','POST',{cascade:true}); t('purge cascade',pu.d.users.length===3&&pu.d.posts>=1&&pu.d.matrix_closed===3,pu);
mp=await j('/api/admin/moderation/posts?user='+encodeURIComponent(B2)); t('posts gone',mp.d.posts.length===0,mp.d);
let lg=await j('/api/auth/login','POST',{username:'b'+sfx,password:'Zx9!kLm2pQw7'},{'content-type':'application/json'}); t('login blocked',lg.s!==200,lg);
let w=await fetch(B+'/api/feed/posts',{headers:{authorization:bauth.authorization}}); t('old token dead',w.status===401||w.status===403,w.status);
let bo=await j('/api/admin/bans'); t('bans listed',bo.d.bans.some(x=>x.user_id===C2&&x.deactivated===1),bo.d);
let codes=db.prepare('SELECT revoked FROM invites WHERE owner=?').all(A); t('codes revoked',codes.every(x=>x.revoked===1),codes);
let rp=await j('/api/admin/stats'); t('stats',rp.d.users>0,rp.d);
console.log('ok',ok,'bad',bad);
