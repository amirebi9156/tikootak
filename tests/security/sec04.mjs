import fs from 'node:fs';
const base=process.env.BASE||'http://localhost:8080', J={'content-type':'application/json'};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1;};
const inv=(await(await fetch(base+'/api/admin/invites',{method:'POST',headers:{...J,'x-admin-key':process.env.ADMIN||'adminkey'},body:JSON.stringify({max_uses:1,expires_days:1})})).json()).code;
const u='lk'+Date.now().toString(36).slice(-5);
const reg=await(await fetch(base+'/api/auth/register',{method:'POST',headers:J,body:JSON.stringify({invite:inv,username:u,password:'Zx9!kLm2pQ7w'})})).json();
const login=(p)=>fetch(base+'/api/auth/login',{method:'POST',headers:J,body:JSON.stringify({username:u,password:p})});
let last;for(let i=0;i<10;i++){last=await login('wrongpass'+i);}
ok(last.status===403,'10 wrong attempts still 403');
let r=await login('Zx9!kLm2pQ7w');ok(r.status===429,'after 10 attempts even the correct password is locked '+r.status);
const A={authorization:'Bearer '+reg.access_token};
const png=fs.readFileSync('pic.png');let codes=[];
for(let i=0;i<7;i++){const x=await fetch(base+'/api/feed/posts',{method:'POST',headers:{...A,'content-type':'image/png','content-length':String(png.length)},body:png});codes.push(x.status);}
ok(codes.slice(0,5).every(c=>c===201)&&codes[5]===429,'new account: 5 posts/day, 6th is 429 '+codes.join(','));
const p=(await(await fetch(base+'/api/feed/posts',{headers:A})).json());const pid=(p.posts||p)[0].id;
const cs=[];for(let i=0;i<4;i++){const x=await fetch(base+`/api/feed/posts/${pid}/comments`,{method:'POST',headers:{...A,...J},body:JSON.stringify({text:'spam spam'})});cs.push(x.status);}
ok(cs.join()==='201,201,429,429','duplicate comment rejected after 2 '+cs.join(','));
