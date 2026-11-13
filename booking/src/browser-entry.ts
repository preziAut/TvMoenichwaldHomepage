// Public, per-tab sandbox: no server API, credentials, real accounts or imported data.
import {PGlite} from '@electric-sql/pglite';
import {BookingService,BookingError} from './service.ts';
import type {Identity} from './service.ts';
import schema from '../migrations/001_core.sql';

declare global {
  interface Window { bookingDemoRequest?: (path:string,method:string,body?:Record<string,unknown>)=>Promise<Response> }
}
const base=new URL('./',import.meta.url);
const message=document.getElementById('message')!;
message.textContent='Die isolierte Testumgebung wird geladen …';
try {
  const [wasmModule,fsBundle]=await Promise.all([
    WebAssembly.compileStreaming(fetch(new URL('pglite.wasm',base))),
    fetch(new URL('pglite.data',base)).then(r=>{if(!r.ok)throw new Error('Demo asset unavailable');return r.blob();}),
  ]);
  const db=new PGlite({wasmModule,fsBundle,extensions:{btree_gist:new URL('btree_gist.tar.gz',base)}});
  await db.exec(schema);
  const service=new BookingService(db);
  const choices:Record<string,{actor:Identity;label:string;role:string}>={};
  for(const [slug,name] of [['moenichwald','Mönichwald'],['waldbach','Waldbach']]) {
    const clubId=crypto.randomUUID(),admin=crypto.randomUUID(),member=crypto.randomUUID();
    await db.query('INSERT INTO clubs VALUES($1,$2,$3)',[clubId,name,'Europe/Vienna']);
    for(const [id,role,label] of [[admin,'admin',`${name} · Admin`],[member,'member',`${name} · Mitglied`]]) {
      await db.query("INSERT INTO members VALUES($1,$2,$3,$4,'active')",[clubId,id,label,role]);
      choices[`${slug}-${role}`]={actor:{clubId,memberId:id},label,role};
    }
    for(let n=1;n<=2;n++) await db.query('INSERT INTO courts(club_id,id,name) VALUES($1,$2,$3)',[clubId,crypto.randomUUID(),`Platz ${n}`]);
    await service.updatePolicy({clubId,memberId:admin},0,{cancellationEnabled:true,cancellationSeconds:7200,advanceDays:14,
      slotMinutes:30,maxDurationMinutes:120,openingMinute:360,closingMinute:1440,maxActiveBookings:0});
  }
  let selected='moenichwald-member';
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vienna',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  window.bookingDemoRequest=async(path,method,body={})=>{
    try {
      const url=new URL(path,location.origin);
      if(url.pathname==='/api/demo-session'&&method==='POST') {
        if(typeof body.choice!=='string'||!Object.hasOwn(choices,body.choice)) return response({error:'FORBIDDEN'},403);
        selected=body.choice;return response({ok:true});
      }
      const choice=choices[selected],actor=choice.actor;
      if(url.pathname==='/api/state'&&method==='GET') {
        const day=url.searchParams.get('day')??'',utc=Date.parse(day+'T00:00:00Z');
        if(!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(utc)||new Date(utc).toISOString().slice(0,10)!==day) return response({error:'INVALID_TIME'},400);
        const slots=[];
        for(let t=utc-10800000;t<utc+97200000;t+=1800000) {
          const p=Object.fromEntries(format.formatToParts(t).map(x=>[x.type,x.value]));
          if(`${p.year}-${p.month}-${p.day}`===day&&Number(p.hour)>=6)
            slots.push({label:`${p.hour}:${p.minute}`,startsAt:new Date(t).toISOString(),endsAt:new Date(t+1800000).toISOString()});
        }
        return response({...await service.calendar(actor,slots[0].startsAt,slots.at(-1)!.endsAt),slots,
          policy:await service.getPolicy(actor),role:choice.role,label:choice.label,choice:selected});
      }
      if(url.pathname==='/api/bookings'&&method==='POST') {
        const r=await service.reserve(actor,body as Parameters<BookingService['reserve']>[1]);return response({id:r.id,state:r.state},201);
      }
      if(url.pathname.startsWith('/api/bookings/')&&method==='DELETE') {
        const r=await service.cancel(actor,url.pathname.slice('/api/bookings/'.length),body.reason as string|undefined);return response({id:r.id,state:r.state});
      }
      if(url.pathname==='/api/policy'&&method==='POST') return response(await service.updatePolicy(actor,body.expectedRevision as number,body.policy as Parameters<BookingService['updatePolicy']>[2]));
      return response({error:'NOT_FOUND'},404);
    }catch(error){return response({error:error instanceof BookingError?error.code:'INTERNAL_ERROR'},409);}
  };
  // The existing UI is plain JavaScript, shared with the local HTTP demo.
  // @ts-expect-error no declaration file is needed for the browser UI entry
  await import('../ui/app.js');
}catch(error) {
  message.textContent='Die Testumgebung konnte nicht geladen werden. Bitte verwende einen aktuellen Browser und lade die Seite erneut.';
  message.classList.add('error');
  console.error('Booking demo initialization failed',error);
}
