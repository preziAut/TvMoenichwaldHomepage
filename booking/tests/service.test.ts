import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {Pool} from 'pg';
import {postgresDatabase} from '../src/database.ts';
import type {Database,Connection} from '../src/database.ts';
import {BookingService} from '../src/service.ts';
import type {PolicyInput,Identity} from '../src/service.ts';

// CI optionally runs the same suite against a fresh real PostgreSQL database.
const pool=process.env.BOOKING_TEST_DATABASE_URL?new Pool({connectionString:process.env.BOOKING_TEST_DATABASE_URL,max:4}):null;
const embedded=pool?null:new PGlite({extensions:{btree_gist}});
const db: Database & Connection & {exec(sql:string):Promise<unknown>;close():Promise<void>}=pool?{
  query:pool.query.bind(pool),
  exec:async(sql:string)=>{await pool.query(sql);},
  transaction:postgresDatabase(pool).transaction,
  close:()=>pool.end(),
}:embedded!;
const club=randomUUID(),otherClub=randomUUID(),admin=randomUUID(),member=randomUUID(),otherMember=randomUUID(),court=randomUUID();
const adminActor={clubId:club,memberId:admin}, memberActor={clubId:club,memberId:member};
const initial:PolicyInput={cancellationEnabled:true,cancellationSeconds:7200,advanceDays:14,slotMinutes:30,
  maxDurationMinutes:120,openingMinute:360,closingMinute:1440,maxActiveBookings:0};
let now=new Date('2030-06-01T06:00:00Z');
const service=new BookingService(db,()=>now);
const request=(start='2030-06-02T08:00:00Z',end='2030-06-02T09:00:00Z')=>({courtId:court,startsAt:start,endsAt:end,requestKey:randomUUID()});
const rejects=(promise:Promise<unknown>,code:string)=>assert.rejects(promise,{code});
before(async()=>{await db.exec(await readFile(new URL('../migrations/001_core.sql',import.meta.url),'utf8'));});
after(async()=>{await db.close();});
beforeEach(async()=>{
  await db.exec('TRUNCATE clubs,members,courts,policies,allocations,audit_events CASCADE');
  now=new Date('2030-06-01T06:00:00Z');
  await db.query('INSERT INTO clubs VALUES($1,$2,$3),($4,$5,$3)',[club,'Demo A','Europe/Vienna',otherClub,'Demo B']);
  for(const [id,role] of [[admin,'admin'],[member,'member'],[otherMember,'member']])
    await db.query("INSERT INTO members VALUES($1,$2,$3,$4,'active')",[club,id,'Synthetic',role]);
  await db.query('INSERT INTO courts(club_id,id,name) VALUES($1,$2,$3)',[club,court,'Court 1']);
  await service.updatePolicy(adminActor,0,initial);
});

test('admin changes are versioned; old bookings retain their cancellation deadline',async()=>{
  const first=await service.reserve(memberActor,request());
  await service.updatePolicy(adminActor,1,{...initial,cancellationSeconds:86400});
  const second=await service.reserve(memberActor,request('2030-06-02T09:00:00Z','2030-06-02T10:00:00Z'));
  assert.equal(first.cancellation_deadline.toISOString(),'2030-06-02T06:00:00.000Z');
  assert.equal(second.cancellation_deadline.toISOString(),'2030-06-01T09:00:00.000Z');
  now=new Date('2030-06-02T05:00:00Z');
  await service.cancel(memberActor,first.id);
  await rejects(service.cancel(memberActor,second.id),'CANCELLATION_CLOSED');
});
test('ordinary users cannot edit rules or override cancellation',async()=>{
  await rejects(service.updatePolicy(memberActor,1,initial),'FORBIDDEN');
  const item=await service.reserve(memberActor,request());
  await rejects(service.cancel(memberActor,item.id,'override'),'FORBIDDEN');
});
test('stale revision and invalid settings fail without a new policy',async()=>{
  await rejects(service.updatePolicy(adminActor,0,initial),'POLICY_CHANGED');
  await rejects(service.updatePolicy(adminActor,1,{...initial,cancellationSeconds:-1}),'INVALID_POLICY');
  assert.equal((await service.getPolicy(adminActor)).revision,1);
});
test('overlap protection allows adjacent slots and rebooking a cancelled slot',async()=>{
  const first=await service.reserve(memberActor,request());
  await rejects(service.reserve(memberActor,request('2030-06-02T08:30:00Z','2030-06-02T09:30:00Z')),'SLOT_TAKEN');
  await service.reserve(memberActor,request('2030-06-02T09:00:00Z','2030-06-02T10:00:00Z'));
  await service.cancel(memberActor,first.id);
  await service.reserve(memberActor,request());
});
test('simultaneous attempts have one winner in the local PostgreSQL runtime',async()=>{
  const results=await Promise.allSettled([service.reserve(memberActor,request()),service.reserve(memberActor,request())]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
});
test('idempotency is exact and does not resurrect a cancelled booking',async()=>{
  const input=request(), first=await service.reserve(memberActor,input);
  assert.equal((await service.reserve(memberActor,input)).id,first.id);
  await rejects(service.reserve(memberActor,{...input,endsAt:'2030-06-02T10:00:00Z'}),'IDEMPOTENCY_MISMATCH');
  await service.cancel(memberActor,first.id);
  assert.equal((await service.reserve(memberActor,input)).state,'cancelled');
});
test('other club and inactive member cannot access calendar or book',async()=>{
  await rejects(service.reserve({clubId:otherClub,memberId:member},request()),'FORBIDDEN');
  await db.query("UPDATE members SET state='inactive' WHERE id=$1",[member]);
  await rejects(service.calendar(memberActor,'2030-06-02T00:00:00Z','2030-06-03T00:00:00Z'),'FORBIDDEN');
});
test('only owner may cancel; admin override requires reason and is audited',async()=>{
  const item=await service.reserve(memberActor,request());
  await rejects(service.cancel({clubId:club,memberId:otherMember},item.id),'FORBIDDEN');
  await rejects(service.cancel(adminActor,item.id,''),'REASON_REQUIRED');
  await service.cancel(adminActor,item.id,'Platz wegen Regen gesperrt');
  const {rows}=await db.query<{action:string}>("SELECT action FROM audit_events WHERE action='booking.cancelled_override'");
  assert.equal(rows.length,1);
});
test('blocks and bookings cannot overlap; members cannot create blocks',async()=>{
  await rejects(service.reserve(memberActor,{...request(),kind:'block',reason:'Training'}),'FORBIDDEN');
  await service.reserve(adminActor,{...request(),kind:'block',reason:'Training'});
  await rejects(service.reserve(memberActor,request()),'SLOT_TAKEN');
});
test('opening hours, duration, slot grid and advance window are checked server-side',async()=>{
  for(const input of [request('2030-06-02T03:00:00Z','2030-06-02T04:00:00Z'),request('2030-06-02T08:15:00Z','2030-06-02T09:15:00Z'),request('2030-06-02T08:00:00Z','2030-06-02T11:00:00Z')])
    await rejects(service.reserve(memberActor,input),'INVALID_SLOT');
  await rejects(service.reserve(memberActor,request('2030-07-02T08:00:00Z','2030-07-02T09:00:00Z')),'OUTSIDE_BOOKING_WINDOW');
});
test('zero cancellation interval allows until start; disabled really disables',async()=>{
  await service.updatePolicy(adminActor,1,{...initial,cancellationSeconds:0});
  const a=await service.reserve(memberActor,request());
  now=new Date('2030-06-02T07:59:59Z');
  await service.cancel(memberActor,a.id);
  now=new Date('2030-06-01T06:00:00Z');
  await service.updatePolicy(adminActor,2,{...initial,cancellationEnabled:false});
  const b=await service.reserve(memberActor,request());
  await rejects(service.cancel(memberActor,b.id),'CANCELLATION_CLOSED');
});
test('calendar does not disclose other accounts or private reasons',async()=>{
  await service.reserve(adminActor,{...request(),kind:'block',reason:'Private internal note'});
  const calendar=await service.calendar(memberActor,'2030-06-02T00:00:00Z','2030-06-03T00:00:00Z');
  const serialized=JSON.stringify(calendar);
  assert.ok(!serialized.includes(admin));
  assert.ok(!serialized.includes('Private internal note'));
  assert.equal(calendar.allocations[0].ownedByMe,false);
});
test('active booking limits exclude cancelled reservations',async()=>{
  await service.updatePolicy(adminActor,1,{...initial,maxActiveBookings:1});
  const a=await service.reserve(memberActor,request());
  await rejects(service.reserve(memberActor,request('2030-06-02T09:00:00Z','2030-06-02T10:00:00Z')),'BOOKING_LIMIT');
  await service.cancel(memberActor,a.id);
  await service.reserve(memberActor,request());
});
test('midnight and winter opening times use the club timezone',async()=>{
  await service.reserve(memberActor,request('2030-06-02T21:00:00Z','2030-06-02T22:00:00Z'));
  now=new Date('2030-12-01T00:00:00Z');
  await service.reserve(memberActor,request('2030-12-02T05:00:00Z','2030-12-02T06:00:00Z'));
  await rejects(service.reserve(memberActor,request('2030-12-02T04:00:00Z','2030-12-02T05:00:00Z')),'INVALID_SLOT');
});
test('cancellation cutoff is inclusive, but a started booking cannot self-cancel',async()=>{
  const a=await service.reserve(memberActor,request());
  now=new Date('2030-06-02T06:00:00Z');
  await service.cancel(memberActor,a.id);
  now=new Date('2030-06-01T06:00:00Z');
  const b=await service.reserve(memberActor,request());
  now=new Date('2030-06-02T06:00:00.001Z');
  await rejects(service.cancel(memberActor,b.id),'CANCELLATION_CLOSED');
});
test('database refuses a court belonging to another club even outside service checks',async()=>{
  const foreignCourt=randomUUID();
  await db.query('INSERT INTO courts(club_id,id,name) VALUES($1,$2,$3)',[otherClub,foreignCourt,'Foreign court']);
  await rejects(service.reserve(memberActor,{...request(),courtId:foreignCourt}),'COURT_UNAVAILABLE');
  const allocation=await service.reserve(memberActor,request());
  await assert.rejects(db.query('UPDATE allocations SET court_id=$1 WHERE id=$2',[foreignCourt,allocation.id]),{code:'23503'});
});
