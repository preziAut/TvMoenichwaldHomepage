// Local synthetic-data demo only. This file is NOT a production authentication server.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {BookingService,BookingError} from './service.ts';
import type {Identity} from './service.ts';

if (process.env.NODE_ENV==='production') throw new Error('The demo must not run in production');
const port=4390, origin=`http://127.0.0.1:${port}`;
const db=new PGlite({extensions:{btree_gist}});
await db.exec(await readFile(new URL('../migrations/001_core.sql',import.meta.url),'utf8'));
const service=new BookingService(db);
const choices:Record<string,{actor:Identity;label:string;role:string}>={};
for(const [slug,name] of [['moenichwald','Mönichwald'],['waldbach','Waldbach']]) {
  const clubId=randomUUID(),admin=randomUUID(),member=randomUUID();
  await db.query('INSERT INTO clubs VALUES($1,$2,$3)',[clubId,name,'Europe/Vienna']);
  for(const [id,role,label] of [[admin,'admin',`${name} · Admin`],[member,'member',`${name} · Mitglied`]]) {
    await db.query("INSERT INTO members VALUES($1,$2,$3,$4,'active')",[clubId,id,label,role]);
    choices[`${slug}-${role}`]={actor:{clubId,memberId:id},label,role};
  }
  for(let n=1;n<=2;n++) await db.query('INSERT INTO courts(club_id,id,name) VALUES($1,$2,$3)',[clubId,randomUUID(),`Platz ${n}`]);
  await service.updatePolicy({clubId,memberId:admin},0,{cancellationEnabled:true,cancellationSeconds:7200,advanceDays:14,
    slotMinutes:30,maxDurationMinutes:120,openingMinute:360,closingMinute:1440,maxActiveBookings:0});
}
const sessions=new Map<string,{choice:string;expires:number}>();
const format=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vienna',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function daySlots(day:string) {
  if(!/^\d{4}-\d\d-\d\d$/.test(day)) throw new BookingError('INVALID_TIME');
  const base=Date.parse(day+'T00:00:00Z');
  if(!Number.isFinite(base)||new Date(base).toISOString().slice(0,10)!==day) throw new BookingError('INVALID_TIME');
  const slots=[];
  for(let t=base-3*3600000;t<base+27*3600000;t+=30*60000) {
    const p=Object.fromEntries(format.formatToParts(t).map(x=>[x.type,x.value]));
    if(`${p.year}-${p.month}-${p.day}`===day && Number(p.hour)>=6)
      slots.push({label:`${p.hour}:${p.minute}`,startsAt:new Date(t).toISOString(),endsAt:new Date(t+30*60000).toISOString()});
  }
  return slots;
}
const assets:Record<string,[string,string]>={
  '/':['../ui/index.html','text/html; charset=utf-8'],
  '/app.js':['../ui/app.js','text/javascript; charset=utf-8'],
  '/style.css':['../ui/style.css','text/css; charset=utf-8'],
};
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try {
    // Loopback bind + Host and Origin validation prevent LAN exposure and DNS rebinding.
    if(req.headers.host!==`127.0.0.1:${port}`) return send(403,{error:'FORBIDDEN'});
    const url=new URL(req.url??'/',origin),method=req.method??'GET';
    if(!['GET','POST','DELETE'].includes(method)) return send(405,{error:'METHOD_NOT_ALLOWED'});
    if(method!=='GET' && (req.headers.origin!==origin || req.headers['content-type']!=='application/json')) return send(403,{error:'FORBIDDEN'});
    if(method==='GET'&&assets[url.pathname]) {
      const [path,type]=assets[url.pathname];
      res.writeHead(200,{'Content-Type':type});res.end(await readFile(new URL(path,import.meta.url)));return;
    }
    let body:Record<string,unknown>={};
    if(method!=='GET') {
      let size=0; const chunks=[];
      for await (const chunk of req) {size+=chunk.length;if(size>8192) return send(413,{error:'BODY_TOO_LARGE'});chunks.push(chunk);}
      try {body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{return send(400,{error:'INVALID_JSON'});}
      if(!body||typeof body!=='object'||Array.isArray(body)) return send(400,{error:'INVALID_JSON'});
    }
    if(url.pathname==='/api/demo-session'&&method==='POST') {
      const choice=body.choice;
      if(typeof choice!=='string'||!Object.hasOwn(choices,choice)) return send(400,{error:'INVALID_DEMO_USER'});
      for(const [id,s] of sessions) if(s.expires<Date.now()) sessions.delete(id);
      const old=req.headers.cookie?.match(/(?:^|; )demo_session=([^;]+)/)?.[1];
      if(old) sessions.delete(old);
      const token=randomUUID();sessions.set(token,{choice,expires:Date.now()+3600000});
      res.setHeader('Set-Cookie',`demo_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
      return send(200,{ok:true});
    }
    const token=req.headers.cookie?.match(/(?:^|; )demo_session=([^;]+)/)?.[1];
    const session=token?sessions.get(token):undefined;
    if(!session||session.expires<Date.now()) return send(401,{error:'DEMO_SESSION_REQUIRED'});
    const choice=choices[session.choice],actor=choice.actor;
    if(url.pathname==='/api/state'&&method==='GET') {
      const slots=daySlots(url.searchParams.get('day')??'');
      const calendar=await service.calendar(actor,slots[0].startsAt,slots.at(-1)!.endsAt);
      return send(200,{...calendar,slots,policy:await service.getPolicy(actor),role:choice.role,label:choice.label,choice:session.choice});
    }
    if(url.pathname==='/api/bookings'&&method==='POST') {
      const result=await service.reserve(actor,body as unknown as Parameters<BookingService['reserve']>[1]);
      return send(201,{id:result.id,state:result.state});
    }
    if(url.pathname.startsWith('/api/bookings/')&&method==='DELETE') {
      const result=await service.cancel(actor,url.pathname.slice('/api/bookings/'.length),body.reason as string|undefined);
      return send(200,{id:result.id,state:result.state});
    }
    if(url.pathname==='/api/policy'&&method==='POST') {
      return send(200,await service.updatePolicy(actor,body.expectedRevision as number,body.policy as Parameters<BookingService['updatePolicy']>[2]));
    }
    return send(404,{error:'NOT_FOUND'});
  }catch(error) {
    const code=error instanceof BookingError?error.code:'INTERNAL_ERROR';
    send(code==='FORBIDDEN'?403:code==='INTERNAL_ERROR'?500:409,{error:code});
  }
});
server.listen(port,'127.0.0.1',()=>console.log(`Local booking demo: ${origin} — synthetic data only, resets on restart`));
