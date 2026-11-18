import { drawGroups, roundRobin, validateGroupAssignment, type Entry } from '../domain/competition.ts';

type Value = string | number | null;
export interface AdminStatement {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface AdminDatabase {
  prepare(sql: string): { bind(...values: Value[]): AdminStatement };
  batch(statements: AdminStatement[]): Promise<unknown>;
}

export class AdminInputError extends Error {}
const invalid = (message: string): never => { throw new AdminInputError(message); };
const string = (value: unknown, max: number) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
const contactName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
const contactKey = (first: string, last: string) => JSON.stringify([first, last].map(name => contactName(name).toLocaleLowerCase('de-AT')));
const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export async function administerChampionship(db: AdminDatabase, actorId: string, id: string | null,
  operation: string, body: Record<string, unknown>) {
  const statement = (sql: string, ...values: Value[]) => db.prepare(sql).bind(...values);
  if (operation === 'anlegen') {
    const title = string(body.title, 120);
    const start = string(body.startsOn, 10);
    const end = body.endsOn ? string(body.endsOn, 10) : null;
    const phase = body.phaseTwo;
    if (!title || !date(start) || (end !== null && (!date(end) || end < start)) ||
        (phase !== 'placement' && phase !== 'knockout')) invalid('Titel, Datum und Folgephase prüfen.');
    const championshipId = crypto.randomUUID();
    const guard = crypto.randomUUID();
    await db.batch([
      statement(`INSERT INTO championship_write_preconditions SELECT ?, EXISTS
        (SELECT 1 FROM championship_memberships WHERE user_id=? AND role='admin' AND active=1)`, guard, actorId),
      statement(`INSERT INTO championships (id,title,season,description,starts_on,ends_on,phase_two,visibility)
        VALUES (?,?,?,?,?,?,?,?)`, championshipId, title, Number(start.slice(0, 4)), string(body.description, 2000),
      start, end, phase as string, body.visibility === 'public' ? 'public' : 'club'),
      statement('DELETE FROM championship_write_preconditions WHERE id=?', guard),
    ]);
    return { id: championshipId, version: 0 };
  }

  const championship = await statement('SELECT version,status,phase_two FROM championships WHERE id=?', id)
    .first<{ version: number; status: string; phase_two: string }>();
  if (operation === 'einstellungen') {
    if (!championship || body.version !== championship.version) throw new AdminInputError('Die Meisterschaft wurde geändert. Bitte lade sie erneut.');
    const title = string(body.title, 120);
    const start = string(body.startsOn, 10);
    const end = body.endsOn ? string(body.endsOn, 10) : null;
    const description = string(body.description, 2000);
    const { phaseTwo, visibility, published, allowSubmissions } = body;
    if (!title || !date(start) || (end !== null && (!date(end) || end < start)) ||
      (phaseTwo !== 'placement' && phaseTwo !== 'knockout') || (visibility !== 'public' && visibility !== 'club') ||
      typeof published !== 'boolean' || typeof allowSubmissions !== 'boolean') invalid('Bitte prüfe die Meisterschaftseinstellungen.');
    if (championship.status === 'draft' && published) invalid('Ein Entwurf wird erst nach dem Start der Vorrunde sichtbar.');
    if (!['draft', 'groups_active'].includes(championship.status) && phaseTwo !== championship.phase_two) {
      invalid('Das Format kann nach dem Start der Folgephase nicht mehr geändert werden.');
    }
    const guard = crypto.randomUUID();
    await db.batch([
      statement(`INSERT INTO championship_write_preconditions SELECT ?, EXISTS (
        SELECT 1 FROM championships c, championship_memberships u WHERE c.id=? AND c.version=?
          AND u.user_id=? AND u.role='admin' AND u.active=1)`, guard, id, championship.version, actorId),
      statement(`UPDATE championships SET title=?,season=?,description=?,starts_on=?,ends_on=?,phase_two=?,visibility=?,published=?,
        allow_submissions=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`, title, Number(start.slice(0, 4)), description,
        start, end, phaseTwo as string, visibility as string, Number(published), Number(allowSubmissions), id),
      statement('DELETE FROM championship_write_preconditions WHERE id=?', guard),
    ]);
    return { id, version: championship.version + 1 };
  }
  if (!championship || championship.status !== 'draft' || body.version !== championship.version) {
    invalid('Dieser Entwurf wurde geändert oder bereits gestartet.');
  }
  const revision = championship!.version;
  const entries = (await statement(`SELECT e.player_id AS id, e.seed, p.display_name FROM championship_entries e
    JOIN championship_players p ON p.id=e.player_id WHERE e.championship_id=? ORDER BY e.seed IS NULL,e.seed,e.player_id`, id)
    .all<Entry & { display_name: string }>()).results;
  const guard = crypto.randomUUID();
  const batch = [statement(`INSERT INTO championship_write_preconditions SELECT ?, EXISTS (
    SELECT 1 FROM championships c, championship_memberships u WHERE c.id=? AND c.version=? AND c.status='draft'
      AND u.user_id=? AND u.role='admin' AND u.active=1)`, guard, id, revision, actorId)];

  if (operation === 'teilnehmer') {
    if (entries.length >= 32) invalid('Höchstens 32 Teilnehmer sind möglich.');
    const existing = string(body.playerId, 80);
    const first = contactName(string(body.firstName, 70));
    const last = contactName(string(body.lastName, 70));
    if (!existing && (!first || !last)) invalid('Vor- und Nachname eingeben oder einen Spieler auswählen.');
    if (existing && entries.some(entry => entry.id === existing)) invalid('Dieser Spieler nimmt bereits teil.');
    const playerId = existing || crypto.randomUUID();
    if (existing) {
      if (!await statement('SELECT id FROM championship_players WHERE id=? AND active=1', existing).first()) {
        invalid('Dieser Kontakt ist nicht mehr aktiv.');
      }
    } else {
      const key = contactKey(first, last);
      const { results: legacy } = await statement('SELECT first_name,last_name FROM championship_players WHERE contact_key IS NULL').all<{
        first_name: string; last_name: string;
      }>();
      if (legacy.some(contact => contactKey(contact.first_name, contact.last_name) === key) ||
          await statement('SELECT id FROM championship_players WHERE contact_key=?', key).first()) {
        invalid('Diesen Kontakt gibt es bereits. Bitte unter „Vorhandenen Kontakt auswählen“ hinzufügen.');
      }
      batch.push(statement('INSERT INTO championship_players (id,first_name,last_name,display_name,contact_key) VALUES (?,?,?,?,?)',
        playerId, first, last, string(body.displayName, 140) || `${first} ${last}`, key));
    }
    batch.push(statement(`INSERT INTO championship_entries (championship_id,player_id) VALUES
      (?,(SELECT id FROM championship_players WHERE id=? AND active=1))`, id, playerId));
  } else if (operation === 'setzliste') {
    const order = body.order;
    if (!Array.isArray(order) || new Set(order).size !== order.length ||
        order.some(player => !entries.some(entry => entry.id === player))) invalid('Ungültige Setzliste.');
    batch.push(statement('UPDATE championship_entries SET seed=NULL WHERE championship_id=?', id));
    (order as string[]).forEach((player, index) => batch.push(statement(
      'UPDATE championship_entries SET seed=? WHERE championship_id=? AND player_id=?', index + 1, id, player)));
  } else if (operation === 'vorschau' || operation === 'starten') {
    const seed = body.seed === undefined ? crypto.getRandomValues(new Uint32Array(1))[0] : Number(body.seed);
    const reason = string(body.reason, 500);
    const manual = Array.isArray(body.groups);
    let groups: string[][];
    try {
      groups = manual ? body.groups as string[][] : drawGroups(entries, Number(body.groupCount), seed);
      if (!groups.every(group => Array.isArray(group) && group.every(player => typeof player === 'string'))) invalid('Ungültige Gruppen.');
      validateGroupAssignment(entries.map(entry => entry.id), groups, reason);
    } catch (error) { throw new AdminInputError(error instanceof Error ? error.message : 'Ungültige Gruppen.'); }
    if (operation === 'vorschau') return { groups, entries, seed, version: revision };
    if (body.confirm !== true || (!manual && body.seed === undefined)) invalid('Die geprüfte Auslosung muss bestätigt werden.');
    // Insert fixtures compactly so a group with many players does not create hundreds of batch statements.
    const fixtures = groups.flatMap((group, index) => roundRobin(group).map(match => ({ ...match, id: crypto.randomUUID(), group: index + 1 })));
    batch.push(
      statement("INSERT INTO championship_stages (championship_id,phase,kind,status,started_at) VALUES (?,1,'group','active',CURRENT_TIMESTAMP)", id),
      statement(`INSERT INTO championship_groups SELECT ?,1,key+1, 'Gruppe ' || char(65+key) FROM json_each(?)`, id, JSON.stringify(groups)),
      statement(`INSERT INTO championship_group_members (championship_id,phase,player_id,group_position)
        SELECT ?,1,p.value,g.key+1 FROM json_each(?) g, json_each(g.value) p`, id, JSON.stringify(groups)),
      statement(`INSERT INTO championship_matches (id,championship_id,phase,group_position,round,home,away)
        SELECT value->>'id',?,1,value->>'group',value->>'round',value->>'home',value->>'away' FROM json_each(?)`, id, JSON.stringify(fixtures)),
      statement(`INSERT INTO championship_draws (id,championship_id,mode,random_seed,seed_snapshot,assignment,generated_by)
        VALUES (?,?,?,?,?,?,?)`, crypto.randomUUID(), id, manual ? 'manual' : 'automatic', manual ? null : seed,
      JSON.stringify(entries.map(({ id: playerId, seed: rank }) => ({ id: playerId, seed: rank }))), JSON.stringify(groups), actorId),
      statement(`UPDATE championships SET status='groups_active', published=?, allow_submissions=? WHERE id=?`,
        body.publish === true ? 1 : 0, body.allowSubmissions === true ? 1 : 0, id),
    );
    if (reason) batch.push(statement(`INSERT INTO championship_decisions (id,championship_id,actor_id,kind,decision,reason)
      VALUES (?,?,?,'draw','{}',?)`, crypto.randomUUID(), id, actorId, reason));
  } else invalid('Aktion nicht verfügbar.');
  batch.push(statement('UPDATE championships SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?', id),
    statement('DELETE FROM championship_write_preconditions WHERE id=?', guard));
  await db.batch(batch);
  return { id, version: revision + 1 };
}
