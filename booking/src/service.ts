import { randomUUID } from 'node:crypto';
import type { Connection, Database } from './database.ts';

// Identity must come from a verified server session, never a public request body.
export type Identity = { clubId: string; memberId: string };
export type PolicyInput = {
  cancellationEnabled: boolean; cancellationSeconds: number; advanceDays: number;
  slotMinutes: number; maxDurationMinutes: number; openingMinute: number;
  closingMinute: number; maxActiveBookings: number;
};
type Policy = PolicyInput & { id: string; revision: number };
type Member = { role: 'member' | 'admin'; timezone: string };
type Allocation = Record<string, unknown> & {
  id: string; court_id: string; owner_id: string; kind: 'booking'|'block';
  state: 'active'|'cancelled'; starts_at: Date; ends_at: Date; reason: string|null;
  policy_id: string; cancellation_enabled: boolean; cancellation_deadline: Date;
};
export class BookingError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new BookingError(code); }
const uuid = (s: unknown): string => typeof s === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(s) ? s : fail('INVALID_ID');
function instant(value: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.000)?Z$/.test(value)) fail('INVALID_TIME');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000Z','Z') !== value.replace('.000Z','Z')) fail('INVALID_TIME');
  return date;
}
function reasonText(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 500) fail('REASON_REQUIRED');
  return value.trim();
}
function validatePolicy(p: PolicyInput) {
  if (!p || typeof p !== 'object' || typeof p.cancellationEnabled !== 'boolean') fail('INVALID_POLICY');
  for (const [key,min,max] of [
    ['cancellationSeconds',0,2592000],['advanceDays',1,365],['maxDurationMinutes',15,1440],
    ['openingMinute',0,1439],['closingMinute',1,1440],['maxActiveBookings',0,100],
  ] as const) {
    if (!Number.isInteger(p[key]) || p[key] < min || p[key] > max) fail('INVALID_POLICY');
  }
  if (![15,30,60].includes(p.slotMinutes) || p.maxDurationMinutes % p.slotMinutes ||
      p.closingMinute <= p.openingMinute || p.openingMinute % p.slotMinutes || p.closingMinute % p.slotMinutes) fail('INVALID_POLICY');
}
function local(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(date).map(p=>[p.type,p.value]));
  return { day:`${parts.year}-${parts.month}-${parts.day}`, minute:Number(parts.hour)*60+Number(parts.minute) };
}
function policyRow(r: Record<string, unknown>): Policy {
  return { id:r.id as string, revision:r.revision as number,
    cancellationEnabled:r.cancellation_enabled as boolean,cancellationSeconds:r.cancellation_seconds as number,
    advanceDays:r.advance_days as number,slotMinutes:r.slot_minutes as number,maxDurationMinutes:r.max_duration_minutes as number,
    openingMinute:r.opening_minute as number,closingMinute:r.closing_minute as number,maxActiveBookings:r.max_active_bookings as number };
}

export class BookingService {
  private db: Database;
  private testClock?: () => Date;
  constructor(db: Database, testClock?: () => Date) { this.db=db; this.testClock=testClock; }

  private async authorize(tx: Connection, actor: Identity): Promise<Member> {
    uuid(actor.clubId); uuid(actor.memberId);
    // Serializes rule changes, booking limits, idempotent retries and cancellations per club.
    await tx.query('SELECT id FROM clubs WHERE id=$1 FOR UPDATE',[actor.clubId]);
    const {rows} = await tx.query(
      `SELECT m.role,c.timezone FROM members m JOIN clubs c ON c.id=m.club_id
       WHERE m.club_id=$1 AND m.id=$2 AND m.state='active' FOR UPDATE OF m`,[actor.clubId,actor.memberId]);
    if (!rows[0]) fail('FORBIDDEN');
    return rows[0] as Member;
  }
  private async now(tx: Connection) {
    return this.testClock ? this.testClock() : (await tx.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now;
  }
  private async policy(tx: Connection, clubId: string): Promise<Policy> {
    const {rows}=await tx.query('SELECT * FROM policies WHERE club_id=$1 ORDER BY revision DESC LIMIT 1',[clubId]);
    if (!rows[0]) fail('POLICY_NOT_CONFIGURED');
    return policyRow(rows[0]);
  }
  private async audit(tx: Connection, actor: Identity, action: string, entity: string, reason?: string) {
    await tx.query('INSERT INTO audit_events(id,club_id,actor_id,action,entity_id,reason) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),actor.clubId,actor.memberId,action,entity,reason??null]);
  }
  async getPolicy(actor: Identity) {
    return this.db.transaction(async tx=>{ await this.authorize(tx,actor); return this.policy(tx,actor.clubId); });
  }
  async updatePolicy(actor: Identity, expectedRevision: number, input: PolicyInput) {
    validatePolicy(input);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_POLICY');
    return this.db.transaction(async tx=>{
      const member=await this.authorize(tx,actor);
      if (member.role!=='admin') fail('FORBIDDEN');
      const {rows}=await tx.query<{revision:number}>('SELECT revision FROM policies WHERE club_id=$1 ORDER BY revision DESC LIMIT 1',[actor.clubId]);
      const previous=rows[0]?.revision??0;
      if (previous!==expectedRevision) fail('POLICY_CHANGED');
      const id=randomUUID();
      await tx.query(`INSERT INTO policies(club_id,id,revision,cancellation_enabled,cancellation_seconds,advance_days,
        slot_minutes,max_duration_minutes,opening_minute,closing_minute,max_active_bookings,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [actor.clubId,id,previous+1,input.cancellationEnabled,input.cancellationSeconds,input.advanceDays,
         input.slotMinutes,input.maxDurationMinutes,input.openingMinute,input.closingMinute,input.maxActiveBookings,actor.memberId]);
      await this.audit(tx,actor,'policy.created',id);
      return { ...input,id,revision:previous+1 };
    });
  }
  async reserve(actor: Identity, input: {courtId:string;startsAt:string;endsAt:string;requestKey:string;kind?:'booking'|'block';reason?:string}) {
    uuid(input.courtId); uuid(input.requestKey);
    const start=instant(input.startsAt), end=instant(input.endsAt), kind=input.kind??'booking';
    if (!['booking','block'].includes(kind) || end<=start) fail('INVALID_TIME');
    const reason=kind==='block'?reasonText(input.reason):null;
    try {
      return await this.db.transaction(async tx=>{
        const member=await this.authorize(tx,actor);
        if (kind==='block' && member.role!=='admin') fail('FORBIDDEN');
        const previous=(await tx.query<Allocation>('SELECT * FROM allocations WHERE club_id=$1 AND owner_id=$2 AND request_key=$3',
          [actor.clubId,actor.memberId,input.requestKey])).rows[0];
        if (previous) {
          if (previous.court_id!==input.courtId || +previous.starts_at!==+start || +previous.ends_at!==+end ||
              previous.kind!==kind || previous.reason!==reason) fail('IDEMPOTENCY_MISMATCH');
          return previous;
        }
        const now=await this.now(tx), p=await this.policy(tx,actor.clubId);
        if (start<=now || +start>+now+p.advanceDays*86400000) fail('OUTSIDE_BOOKING_WINDOW');
        const court=(await tx.query('SELECT id FROM courts WHERE club_id=$1 AND id=$2 AND enabled=true',[actor.clubId,input.courtId])).rows[0];
        if (!court) fail('COURT_UNAVAILABLE');
        if (kind==='booking') {
          const a=local(start,member.timezone), b=local(new Date(+end-1),member.timezone);
          const endMinute=b.minute+1;
          if (a.day!==b.day || start.getUTCSeconds() || end.getUTCSeconds() ||
              a.minute<p.openingMinute || endMinute>p.closingMinute ||
              a.minute%p.slotMinutes || endMinute%p.slotMinutes ||
              (+end-+start)%(p.slotMinutes*60000) || (+end-+start)>p.maxDurationMinutes*60000) fail('INVALID_SLOT');
          if (p.maxActiveBookings) {
            const count=(await tx.query<{count:number}>(`SELECT count(*)::int AS count FROM allocations
              WHERE club_id=$1 AND owner_id=$2 AND kind='booking' AND state='active' AND ends_at>$3`,[actor.clubId,actor.memberId,now])).rows[0].count;
            if (count>=p.maxActiveBookings) fail('BOOKING_LIMIT');
          }
        } else if (+end-+start>31*86400000) fail('INVALID_SLOT');
        const id=randomUUID(), deadline=new Date(+start-p.cancellationSeconds*1000);
        const result=await tx.query<Allocation>(`INSERT INTO allocations(club_id,id,court_id,owner_id,kind,starts_at,ends_at,
          policy_id,cancellation_enabled,cancellation_deadline,request_key,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [actor.clubId,id,input.courtId,actor.memberId,kind,start,end,p.id,p.cancellationEnabled,deadline,input.requestKey,reason]);
        await this.audit(tx,actor,kind==='block'?'court.blocked':'booking.created',id,reason??undefined);
        return result.rows[0];
      });
    } catch(error) {
      if ((error as {code?:string}).code==='23P01') fail('SLOT_TAKEN');
      throw error;
    }
  }
  async cancel(actor: Identity,id:string,overrideReason?:string) {
    uuid(id);
    return this.db.transaction(async tx=>{
      const member=await this.authorize(tx,actor);
      const item=(await tx.query<Allocation>('SELECT * FROM allocations WHERE club_id=$1 AND id=$2 FOR UPDATE',[actor.clubId,id])).rows[0];
      if (!item) fail('NOT_FOUND');
      const own=item.owner_id===actor.memberId && item.kind==='booking';
      const override=overrideReason!==undefined;
      if (override && member.role!=='admin') fail('FORBIDDEN');
      if (!own && !override) fail('FORBIDDEN');
      const reason=override?reasonText(overrideReason):undefined;
      if (item.state==='cancelled') return item;
      const now=await this.now(tx);
      if (!override && (!item.cancellation_enabled || now>item.cancellation_deadline || now>=item.starts_at)) fail('CANCELLATION_CLOSED');
      const updated=(await tx.query<Allocation>("UPDATE allocations SET state='cancelled' WHERE club_id=$1 AND id=$2 RETURNING *",[actor.clubId,id])).rows[0];
      await this.audit(tx,actor,override?'booking.cancelled_override':'booking.cancelled',id,reason);
      return updated;
    });
  }
  async calendar(actor: Identity,from:string,to:string) {
    const start=instant(from),end=instant(to);
    if (end<=start || +end-+start>8*86400000) fail('INVALID_RANGE');
    return this.db.transaction(async tx=>{
      await this.authorize(tx,actor);
      const courts=(await tx.query<{id:string;name:string}>('SELECT id,name FROM courts WHERE club_id=$1 AND enabled=true ORDER BY name',[actor.clubId])).rows;
      const items=(await tx.query<Allocation>(`SELECT * FROM allocations WHERE club_id=$1 AND state='active'
        AND starts_at<$3 AND ends_at>$2 ORDER BY starts_at`,[actor.clubId,start,end])).rows;
      return {courts,allocations:items.map(r=>({id:r.id,courtId:r.court_id,kind:r.kind,startsAt:r.starts_at,endsAt:r.ends_at,
        ownedByMe:r.owner_id===actor.memberId,cancellationDeadline:r.owner_id===actor.memberId?r.cancellation_deadline:null}))};
    });
  }
}
