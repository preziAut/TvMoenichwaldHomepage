"""Offline ep-3 audit and repeatable staging import. Never executes source SQL/PHP.

Only aggregate reports may be published. The staging database contains personal data.
It is a migration rehearsal, not a production application database.
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'booking/.private'
KNOWN = {'bookings', 'bookings_bills', 'bookings_meta', 'events', 'events_meta',
         'options', 'reservations', 'reservations_meta', 'squares', 'squares_coupons',
         'squares_meta', 'squares_pricing', 'squares_products', 'users', 'users_meta'}
STATUSES = {'enabled', 'admin', 'assist', 'blocked', 'disabled', 'deleted', 'placeholder'}


def parse_values(text, start):
    """Parse phpMyAdmin INSERT values; distinguish SQL NULL from quoted 'NULL'."""
    i = start
    def whitespace():
        nonlocal i
        while i < len(text) and text[i].isspace():
            i += 1
    result = []
    while True:
        whitespace()
        if text[i] != '(':
            raise ValueError('Expected row tuple')
        i += 1
        row = []
        while True:
            whitespace()
            if text[i] == "'":
                i += 1
                value = ''
                while True:
                    c = text[i]
                    i += 1
                    if c == '\\':
                        c = text[i]
                        i += 1
                        value += {'n': '\n', 'r': '\r', 't': '\t', '0': '\0', 'Z': '\x1a'}.get(c, c)
                    elif c == "'":
                        if text[i:i+1] == "'":
                            value += "'"
                            i += 1
                        else:
                            break
                    else:
                        value += c
            else:
                end = i
                while text[end] not in ',)':
                    end += 1
                value = text[i:end].strip()
                if value.upper() == 'NULL':
                    value = None
                elif not re.fullmatch(r'-?\d+(?:\.\d+)?', value):
                    raise ValueError('Unsupported SQL expression')
                i = end
            row.append(value)
            whitespace()
            sep = text[i]
            i += 1
            if sep == ')':
                break
            if sep != ',':
                raise ValueError('Expected column separator')
        result.append(row)
        whitespace()
        sep = text[i]
        i += 1
        if sep == ';':
            return result, i
        if sep != ',':
            raise ValueError('Expected row separator')


def read_dump(path):
    text = Path(path).read_text(encoding='utf-8-sig')
    schema = {m[1]: re.findall(r'^\s*`([^`]+)`', m[2], re.M)
              for m in re.finditer(r'CREATE TABLE `([^`]+)` \((.*?)\n\)', text, re.S)}
    if not schema or set(schema) - {'bs_' + t for t in KNOWN}:
        raise ValueError('Unknown or missing ep-3 schema; manual review required')
    data = {name: [] for name in schema}
    position = 0
    pattern = re.compile(r'INSERT INTO `([^`]+)`\s*\(([^;]*?)\)\s*VALUES\s*', re.S)
    while match := pattern.search(text, position):
        table = match[1]
        columns = re.findall(r'`([^`]+)`', match[2])
        if table not in schema or set(columns) != set(schema[table]):
            raise ValueError('INSERT columns differ from schema')
        values, position = parse_values(text, match.end())
        for row in values:
            if len(row) != len(columns):
                raise ValueError('Column count mismatch')
            data[table].append(dict(zip(columns, row)))
    if len(re.findall(r'^INSERT INTO ', text, re.M)) != len(list(pattern.finditer(text))):
        raise ValueError('Unsupported INSERT format')
    for table, records in data.items():
        ids = [r[schema[table][0]] for r in records]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate source primary key')
    return data, schema


def local_interval(date, start, end):
    day = dt.date.fromisoformat(date)
    def point(value):
        if value == '24:00:00':
            return dt.datetime.combine(day + dt.timedelta(days=1), dt.time())
        return dt.datetime.combine(day, dt.time.fromisoformat(value))
    a, b = point(start), point(end)
    if b <= a:
        raise ValueError('Non-positive reservation interval')
    return a.isoformat(), b.isoformat()


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def create_schema(db):
    db.executescript('''
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sources(club TEXT PRIMARY KEY, sha256 TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts(
      club TEXT, legacy_id TEXT, alias TEXT, email TEXT, legacy_status TEXT,
      activation_state TEXT CHECK(activation_state IN ('reset_required','review_required','inactive')),
      role TEXT CHECK(role='none'), PRIMARY KEY(club,legacy_id));
    CREATE TABLE IF NOT EXISTS courts(club TEXT, legacy_id TEXT, rules_json TEXT,
      PRIMARY KEY(club,legacy_id));
    CREATE TABLE IF NOT EXISTS bookings(club TEXT, legacy_id TEXT, account_id TEXT,
      court_id TEXT, status TEXT, billing_status TEXT, visibility TEXT, quantity INTEGER,
      created_local TEXT, PRIMARY KEY(club,legacy_id),
      FOREIGN KEY(club,account_id) REFERENCES accounts(club,legacy_id),
      FOREIGN KEY(club,court_id) REFERENCES courts(club,legacy_id));
    CREATE TABLE IF NOT EXISTS occurrences(club TEXT, legacy_id TEXT, booking_id TEXT,
      starts_local TEXT, ends_local TEXT, PRIMARY KEY(club,legacy_id),
      FOREIGN KEY(club,booking_id) REFERENCES bookings(club,legacy_id));
    CREATE TABLE IF NOT EXISTS source_records(club TEXT, source_table TEXT, legacy_id TEXT,
      payload_json TEXT, PRIMARY KEY(club,source_table,legacy_id));
    CREATE TABLE IF NOT EXISTS issues(club TEXT, kind TEXT, reference TEXT, detail TEXT);
    ''')


def import_club(db, club, path):
    data, schema = read_dump(path)
    sha = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    users, courts = data['bs_users'], data['bs_squares']
    if {u['status'] for u in users} - STATUSES:
        raise ValueError('Unknown account status')
    user_ids = {u['uid'] for u in users}
    court_ids = {c['sid'] for c in courts}
    issues = []
    def issue(kind, ref, detail=''):
        issues.append((club, kind, ref, detail))
    # Replace only this club in one transaction; reruns cannot duplicate rows.
    for table in ('issues','occurrences','bookings','accounts','courts','source_records','sources'):
        db.execute(f'DELETE FROM {table} WHERE club=?', (club,))
    db.execute('INSERT INTO sources VALUES (?,?)', (club, sha))
    for table, records in data.items():
        for record in records:
            clean = dict(record)
            if table == 'bs_users':
                for key in ('pw','last_ip','login_detent','login_attempts'):
                    clean.pop(key, None)
            if table == 'bs_users_meta' and re.search(r'pw|password|token|secret|session|activation|reset', record['key'], re.I):
                issue('excluded_auth_metadata', record[schema[table][0]])
                continue
            db.execute('INSERT INTO source_records VALUES (?,?,?,?)',
                       (club, table, record[schema[table][0]], encode(clean)))
    emails = collections.Counter(u['email'].strip().casefold() for u in users if u['email'])
    for u in users:
        state = 'inactive'
        if u['status'] in ('enabled','admin','assist'):
            email = (u['email'] or '').strip().casefold()
            state = 'reset_required' if re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email) and emails[email] == 1 else 'review_required'
            if u['status'] in ('admin','assist'):
                state = 'review_required'
                issue('privileged_account_review', u['uid'])
        db.execute('INSERT INTO accounts VALUES (?,?,?,?,?,?,?)',
                   (club,u['uid'],u['alias'],u['email'],u['status'],state,'none'))
    for c in courts:
        db.execute('INSERT INTO courts VALUES (?,?,?)', (club,c['sid'],encode(c)))
    accepted = {}
    for b in data['bs_bookings']:
        if b['uid'] not in user_ids or b['sid'] not in court_ids:
            issue('orphan_booking',b['bid'])
            continue
        if b['status'] not in ('single','subscription','cancelled'):
            issue('unknown_booking_status',b['bid'])
            continue
        db.execute('INSERT INTO bookings VALUES (?,?,?,?,?,?,?,?,?)',
                   (club,b['bid'],b['uid'],b['sid'],b['status'],b['status_billing'],b['visibility'],int(b['quantity']),b['created']))
        accepted[b['bid']] = b
    occupied = collections.defaultdict(list)
    for r in data['bs_reservations']:
        b = accepted.get(r['bid'])
        if not b:
            issue('orphan_reservation',r['rid'])
            continue
        try:
            start, end = local_interval(r['date'],r['time_start'],r['time_end'])
        except ValueError:
            issue('invalid_interval',r['rid'])
            continue
        db.execute('INSERT INTO occurrences VALUES (?,?,?,?,?)',(club,r['rid'],r['bid'],start,end))
        if b['status'] != 'cancelled':
            occupied[b['sid']].append((start,end,r['rid']))
    for intervals in occupied.values():
        active = []
        for start, end, rid in sorted(intervals):
            active = [x for x in active if x[0] > start]
            for previous_end, previous_id in active:
                issue('overlapping_reservations',rid,previous_id)
            active.append((end,rid))
    # Validate all ancillary relationships without silently discarding historical rows.
    primary = {t:{r[schema[t][0]] for r in records} for t,records in data.items()}
    for t,parent,key in [('bs_users_meta','bs_users','uid'),('bs_bookings_meta','bs_bookings','bid'),
                         ('bs_bookings_bills','bs_bookings','bid'),('bs_events_meta','bs_events','eid'),
                         ('bs_reservations_meta','bs_reservations','rid'),('bs_squares_meta','bs_squares','sid')]:
        for r in data.get(t,[]):
            if r[key] not in primary.get(parent,set()):
                issue('orphan_metadata',t+':'+r[schema[t][0]])
    db.executemany('INSERT INTO issues VALUES (?,?,?,?)',issues)
    hashes = collections.Counter('bcrypt_cost_'+u['pw'][4:6] if u['pw'] and re.fullmatch(r'\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}',u['pw']) else 'missing_or_other' for u in users)
    dates = [r['date'] for r in data['bs_reservations']]
    return {'source_sha256':sha,'source_counts':{t:len(v) for t,v in data.items()},
            'account_statuses':dict(collections.Counter(u['status'] for u in users)),
            'password_formats':dict(hashes),'duplicate_email_groups':sum(n>1 for n in emails.values()),
            'activation_states':dict(db.execute('SELECT activation_state,count(*) FROM accounts WHERE club=? GROUP BY activation_state',(club,))),
            'reservation_date_range':[min(dates),max(dates)] if dates else [],
            'normalized_counts':{t:db.execute(f'SELECT count(*) FROM {t} WHERE club=?',(club,)).fetchone()[0] for t in ('accounts','courts','bookings','occurrences','source_records')},
            'issues':dict(collections.Counter(i[1] for i in issues)),
            'ready_for_production':False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--moenichwald',type=Path,required=True)
    parser.add_argument('--waldbach',type=Path,required=True)
    args = parser.parse_args()
    PRIVATE.mkdir(parents=True,exist_ok=True)
    db = sqlite3.connect(PRIVATE/'rehearsal.sqlite3')
    create_schema(db)
    try:
        with db:
            reports = {club:import_club(db,club,path) for club,path in
                       [('moenichwald',args.moenichwald),('waldbach',args.waldbach)]}
            if db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('Foreign key validation failed')
        # Intentionally local only; review even aggregate statistics before publishing.
        (PRIVATE/'audit.json').write_text(encode(reports)+'\n',encoding='utf-8')
        print(encode(reports))
    finally:
        db.close()


if __name__ == '__main__':
    main()
