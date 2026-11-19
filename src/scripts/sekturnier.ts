import { helperRequirements, type RoundPlayer } from '../../championships/domain/sekt.ts';
import { championshipRole } from './meisterschaft-session.ts';
import { championshipButton as button } from './meisterschaft-buttons.ts';

type SektEvent = { id: string; title: string; starts_on: string; default_games: number; status: string;
  version: number; published: number; deleted_at: string | null };
type Entry = { id: string; name: string; pot: 1 | 2 };
type Round = { id: string; number: number; games: number; status: string };
type Player = { round_id: string; player_id: string; pot: 1 | 2; helper: number };
type Match = { id: string; round_id: string; position: number; home_games: number | null; away_games: number | null; version: number };
type Appearance = { match_id: string; player_id: string; team: number; counted: number };
type Data = { event: SektEvent; canManage: boolean; entries: Entry[]; rounds: Round[]; players: Player[]; matches: Match[];
  appearances: Appearance[]; standings: { player_id: string; name: string; rank: number; games: number; appearances: number }[] };
type Contact = { id: string; display_name: string; active: number };
type Audit = { id: string; action: string; round_id: string | null; match_id: string | null; previous_value: string | null;
  new_value: string; reason: string; created_at: string; actor: string };

function initializeSekt() {
  const root = document.querySelector<HTMLElement>('#sekt-root');
  if (!root) return;
  const page = root;
  const id = new URLSearchParams(location.search).get('id');
  const publicView = new URLSearchParams(location.search).has('ansicht');
  const controller = new AbortController();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let admin = false;
  let state: Data | undefined;
  let editorVersion = 0;
  let dirty = false;
  let saving = false;
  let contacts: Contact[] = [];
  const select = <T extends HTMLElement = HTMLElement>(selector: string) => page.querySelector<T>(selector)!;
  const message = select('#sekt-message');
  const detail = select('#sekt-detail');
  const panel = select('#sekt-admin');
  const roundSelect = select<HTMLSelectElement>('#sekt-round-select');
  const draw = select<HTMLFormElement>('#sekt-draw');
  const settings = select<HTMLFormElement>('#sekt-settings');
  const field = <T extends HTMLInputElement | HTMLSelectElement>(form: HTMLFormElement, name: string) => form.elements.namedItem(name) as T;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, label = '', classes = '') => {
    const element = document.createElement(tag);
    element.textContent = label;
    element.className = classes;
    return element;
  };
  const actionButton = (label: string, handler: () => void, classes = button.secondary) => {
    const element = node('button', label, classes);
    element.type = 'button';
    element.onclick = handler;
    return element;
  };
  async function api<T>(path = '', body?: object): Promise<T> {
    const response = await fetch('/api/sekturniere' + path + (publicView ? '?oeffentlich=1' : ''), {
      signal: controller.signal, cache: 'no-store',
      ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Turnierdaten sind derzeit nicht verfügbar.');
    return result;
  }
  function showError(error: unknown) {
    if (!disposed) message.textContent = error instanceof Error ? error.message : 'Die Anfrage ist fehlgeschlagen.';
  }
  function markDirty(event: Event) {
    if (event.target instanceof Element && (event.target.closest('#sekt-admin') || event.target.closest('[data-result-form]'))) dirty = true;
  }
  page.addEventListener('input', markDirty);
  page.addEventListener('change', markDirty);
  async function mutate(action: string, body: object = {}, version = editorVersion) {
    if (saving || !id) return false;
    saving = true;
    panel.inert = true;
    select('#sekt-matches').inert = true;
    try {
      await api(`/${encodeURIComponent(id)}/${action}`, { ...body, version });
      dirty = false;
      if (action === 'runde-vorbereiten' || action === 'runde-verwerfen') roundSelect.value = '';
      await refresh(true);
      message.textContent = 'Änderung gespeichert.';
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      saving = false;
      panel.inert = false;
      select('#sekt-matches').inert = false;
    }
  }
  function rowsForDraw(): RoundPlayer[] {
    return [...select('#sekt-pot-players').querySelectorAll<HTMLElement>('[data-player]')].map(row => ({
      id: row.dataset.player!, pot: Number(row.querySelector('select')!.value) as 1 | 2,
      helper: row.querySelector<HTMLInputElement>('input')!.checked,
    }));
  }
  function showRequirements() {
    const players = rowsForDraw();
    const first = players.filter(player => player.pot === 1);
    const second = players.filter(player => player.pot === 2);
    const needs = helperRequirements(first.length, second.length);
    const remaining = (pot: RoundPlayer[], count: number) => count - pot.filter(player => player.helper).length;
    const selection = (count: number) => count > 0 ? `noch ${count} auswählen` : count < 0 ? `${-count} zu viel ausgewählt` : 'vollständig';
    select('#sekt-helper-need').textContent = !needs.playable
      ? 'Diese Topfverteilung ist nicht spielbar. Mindestens zwei Personen pro Topf und genügend unterschiedliche Aushilfen sind erforderlich.'
      : `Topf 1 · ${first.length} Personen · ${needs.first} Aushilfen nötig · ${selection(remaining(first, needs.first))}. Topf 2 · ${second.length} Personen · ${needs.second} Aushilfen nötig · ${selection(remaining(second, needs.second))}. ${needs.matches} Partien.`;
    select<HTMLButtonElement>('#sekt-draw-submit').disabled = !needs.playable ||
      remaining(first, needs.first) !== 0 || remaining(second, needs.second) !== 0;
  }
  function renderStandings(data: Data) {
    const body = select('#sekt-ranking');
    body.replaceChildren(...data.standings.map(row => {
      const tr = node('tr', '', 'border-t border-stone-100 odd:bg-stone-50/60');
      tr.append(node('td', String(row.rank), 'px-4 py-3 font-semibold'),
        node('th', row.name, 'min-w-28 break-words px-3 py-3 font-semibold'),
        node('td', String(row.games), 'px-3 py-3 text-right font-bold text-orange-800'),
        node('td', String(row.appearances), 'px-3 py-3 text-right'));
      tr.querySelector('th')!.scope = 'row';
      return tr;
    }));
    const latest = data.rounds.at(-1);
    select('#sekt-ranking-status').textContent = data.event.status === 'finished' ? 'Endstand' : latest
      ? `Runde ${latest.number} · ${latest.status === 'closed' ? 'vollständig' : 'vorläufig'}` : 'Noch keine Runde';
    select('#sekt-refresh').textContent = 'Automatisch aktualisiert · ' + new Date().toLocaleTimeString('de-AT');
  }
  function renderMatches(data: Data) {
    const round = data.rounds.find(row => row.id === roundSelect.value);
    const games = data.matches.filter(match => match.round_id === round?.id);
    select('#sekt-round-note').textContent = round
      ? `${round.games} Games · ${{ prepared: 'In Vorbereitung', active: 'Laufende Runde', closed: 'Runde abgeschlossen' }[round.status]} · ${games.filter(match => match.home_games !== null).length} von ${games.length} Ergebnissen. Aushilfen spielen ihre Partien nacheinander.`
      : 'Die erste Runde wird von der Turnierleitung vorbereitet.';
    const names = new Map(data.entries.map(entry => [entry.id, entry.name]));
    const pots = new Map(data.players.filter(player => player.round_id === round?.id).map(player => [player.player_id, player.pot]));
    select('#sekt-matches').replaceChildren(...games.map(match => {
      const card = node('article', '', 'min-w-0 rounded-2xl border border-stone-200 bg-white p-5');
      card.append(node('h3', `Partie ${match.position}`, 'mb-4 font-bold text-[#173a2e]'));
      for (const team of [1, 2]) {
        const line = node('div', '', 'mb-3 flex items-center justify-between gap-3 rounded-xl bg-stone-50 p-3');
        const members = node('div', '', 'min-w-0 space-y-2');
        for (const appearance of data.appearances.filter(row => row.match_id === match.id && row.team === team)) {
          const player = node('p', names.get(appearance.player_id) ?? 'Teilnehmer', 'break-words text-sm font-semibold');
          player.append(node('span', `Topf ${pots.get(appearance.player_id)} · ${appearance.counted ? 'gewertet' : 'Aushilfe · ohne eigene Wertung'}`,
            `mt-0.5 block text-xs font-normal ${appearance.counted ? 'text-slate-500' : 'text-orange-800'}`));
          members.append(player);
        }
        line.append(members, node('span', String((team === 1 ? match.home_games : match.away_games) ?? '–'),
          'shrink-0 text-2xl font-bold tabular-nums text-[#173a2e]'));
        card.append(line);
      }
      if (admin && !data.event.deleted_at) {
        const form = node('form', '', 'mt-4 border-t border-stone-200 pt-4');
        form.dataset.resultForm = match.id;
        const fields = node('div', '', 'grid grid-cols-2 gap-3');
        const inputs = [1, 2].map(team => {
          const label = node('label', `Games Team ${team}`);
          const input = node('input');
          Object.assign(input, { type: 'number', min: '0', max: String(round!.games), step: '1', required: true });
          input.value = String((team === 1 ? match.home_games : match.away_games) ?? '');
          label.append(input); fields.append(label);
          return input;
        });
        form.append(fields);
        const reason = node('input');
        if (match.home_games !== null) {
          const label = node('label', 'Korrekturkommentar');
          Object.assign(reason, { required: true, maxLength: 500 });
          label.append(reason); form.append(label);
        }
        const submit = node('button', match.home_games === null ? 'Endergebnis speichern' : 'Ergebnis korrigieren', button.primary);
        submit.type = 'submit';
        form.append(submit);
        const version = data.event.version;
        form.onsubmit = event => {
          event.preventDefault();
          if (match.home_games === null && !confirm('Endergebnis bestätigen und in der Tabelle werten?')) return;
          void mutate('ergebnis', { matchId: match.id, matchVersion: match.version,
            home: inputs[0].valueAsNumber, away: inputs[1].valueAsNumber, reason: reason.value }, version);
        };
        card.append(form);
      }
      return card;
    }));
  }
  function renderAdmin(data: Data) {
    const event = data.event;
    const latest = data.rounds.at(-1);
    editorVersion = event.version;
    panel.hidden = !admin;
    if (!admin) return;
    select<HTMLButtonElement>('#sekt-prepare').hidden = Boolean(event.deleted_at) || event.status === 'finished' || Boolean(latest && latest.status !== 'closed');
    select<HTMLButtonElement>('#sekt-close-round').hidden = Boolean(event.deleted_at) || latest?.status !== 'active';
    select<HTMLButtonElement>('#sekt-finish').hidden = Boolean(event.deleted_at) || event.status !== 'active' || latest?.status !== 'closed';
    draw.hidden = Boolean(event.deleted_at) || latest?.status !== 'prepared';
    if (!draw.hidden && latest) {
      field<HTMLInputElement>(draw, 'games').value = String(latest.games);
      select('#sekt-pot-players').replaceChildren(...data.players.filter(player => player.round_id === latest.id).map(player => {
        const entry = data.entries.find(entry => entry.id === player.player_id)!;
        const row = node('div', '', 'rounded-xl border border-stone-200 bg-stone-50 p-4');
        row.dataset.player = player.player_id;
        row.append(node('p', entry.name, 'mb-2 break-words font-semibold'));
        const label = node('label', 'Topf');
        const pot = node('select', '', 'mt-2 block w-full rounded-lg border border-stone-300 bg-white p-2');
        pot.append(new Option('Topf 1', '1'), new Option('Topf 2', '2'));
        pot.value = String(player.pot);
        pot.onchange = showRequirements; label.append(pot);
        const helper = node('label', ' Als Aushilfe zusätzlich einsetzen');
        const check = node('input');
        check.type = 'checkbox'; check.checked = Boolean(player.helper); check.onchange = showRequirements;
        helper.prepend(check); row.append(label, helper);
        return row;
      }));
      showRequirements();
    }
    select<HTMLButtonElement>('#sekt-redraw').hidden = Boolean(event.deleted_at) || latest?.status !== 'active' ||
      data.matches.some(match => match.round_id === latest.id && match.home_games !== null);
    select('#sekt-participant-panel').hidden = event.status !== 'draft' || Boolean(latest) || Boolean(event.deleted_at);
    const existing = new Set(data.entries.map(entry => entry.id));
    const reuse = select<HTMLFormElement>('#sekt-reuse');
    const available = contacts.filter(contact => contact.active && !existing.has(contact.id));
    field<HTMLSelectElement>(reuse, 'playerId').replaceChildren(new Option('Kontakt auswählen', ''),
      ...available.map(contact => new Option(contact.display_name, contact.id)));
    reuse.querySelector('button')!.disabled = available.length === 0;
    select('#sekt-entries').replaceChildren(...data.entries.map(entry => {
      const item = node('li', '', 'flex items-center justify-between gap-3 py-3 text-sm');
      item.append(node('span', `${entry.name} · Topf ${entry.pot}`, 'min-w-0 break-words'),
        actionButton('Entfernen', () => {
          if (confirm(`${entry.name} aus diesem Turnier entfernen?`)) void mutate('entfernen', { playerId: entry.id });
        }));
      return item;
    }));
    field<HTMLInputElement>(settings, 'title').value = event.title;
    field<HTMLInputElement>(settings, 'startsOn').value = event.starts_on;
    field<HTMLInputElement>(settings, 'defaultGames').value = String(event.default_games);
    field<HTMLInputElement>(settings, 'published').checked = Boolean(event.published);
    field<HTMLInputElement>(settings, 'published').disabled = event.status === 'draft';
    settings.hidden = Boolean(event.deleted_at);
    select('#sekt-delete').hidden = Boolean(event.deleted_at);
    select('#sekt-restore').hidden = !event.deleted_at;
  }
  async function history() {
    if (!admin || !id) return;
    const records = await api<Audit[]>(`/${encodeURIComponent(id)}/historie`);
    const labels: Record<string, string> = { anlegen: 'Turnier angelegt', einstellungen: 'Einstellungen geändert', teilnehmer: 'Teilnehmer hinzugefügt',
      entfernen: 'Teilnehmer entfernt', 'runde-vorbereiten': 'Runde vorbereitet', 'runde-auslosen': 'Runde ausgelost',
      'runde-neu': 'Runde zurückgesetzt', 'runde-verwerfen': 'Runde verworfen', ergebnis: 'Ergebnis gespeichert oder korrigiert',
      'runde-abschliessen': 'Runde abgeschlossen', abschliessen: 'Turnier abgeschlossen', loeschen: 'Turnier gelöscht', wiederherstellen: 'Turnier wiederhergestellt' };
    select('#sekt-history').replaceChildren(...records.map(record => {
      const item = node('article', '', 'rounded-xl border border-stone-200 p-4 text-sm');
      const round = state?.rounds.find(round => round.id === record.round_id);
      const match = state?.matches.find(match => match.id === record.match_id);
      item.append(node('h3', `${labels[record.action] ?? record.action}${round ? ` · Runde ${round.number}` : ''}${match ? ` · Partie ${match.position}` : ''}`, 'font-bold'));
      item.append(node('p', `${new Date(record.created_at.replace(' ', 'T') + 'Z').toLocaleString('de-AT')} · ${record.actor}`, 'mt-1 text-xs text-slate-500'));
      if (record.reason) item.append(node('p', record.reason, 'mt-2 break-words'));
      if (record.action === 'ergebnis') {
        const previous = JSON.parse(record.previous_value ?? '{}');
        const next = JSON.parse(record.new_value);
        item.append(node('p', `${previous.home === null ? 'Offen' : `${previous.home}:${previous.away}`} → ${next.home}:${next.away}`, 'mt-2 font-semibold'));
      }
      return item;
    }));
  }
  async function refresh(force = false) {
    if (!id || disposed) return;
    const data = await api<Data>(`/${encodeURIComponent(id)}`);
    if (disposed) return;
    if (state && data.event.version < state.event.version) return;
    const changed = data.event.version !== state?.event.version;
    if (admin && !data.canManage) { admin = false; dirty = false; }
    state = data;
    detail.hidden = false;
    select('#sekt-title').textContent = data.event.title;
    select('#sekt-event-status').textContent = data.event.deleted_at ? 'Gelöscht · nur für Admins sichtbar' :
      ({ draft: 'Entwurf', active: 'Laufendes Turnier', finished: 'Abgeschlossen' }[data.event.status] ?? '');
    const share = select<HTMLAnchorElement>('#sekt-share');
    share.href = `/meisterschaften/sekturnier/?id=${encodeURIComponent(id)}&ansicht=oeffentlich`;
    share.hidden = admin && (!data.event.published || data.event.status === 'draft' || Boolean(data.event.deleted_at));
    renderStandings(data);
    if (force || !dirty) {
      const selected = roundSelect.value;
      roundSelect.replaceChildren(...data.rounds.map(round => new Option(`Runde ${round.number}`, round.id)));
      roundSelect.value = data.rounds.some(round => round.id === selected) ? selected : data.rounds.at(-1)?.id ?? '';
      renderMatches(data);
      renderAdmin(data);
    } else if (changed) message.textContent = 'Der Turnierstand wurde aktualisiert. Deine Eingaben bleiben erhalten. Bei einem Konflikt bitte den aktuellen Stand laden.';
    if (admin && select<HTMLDetailsElement>('#sekt-history-panel').open) await history();
  }
  roundSelect.onchange = () => {
    if (dirty && !confirm('Nicht gespeicherte Eingaben verwerfen und die Runde wechseln?')) return;
    dirty = false;
    if (state) { renderMatches(state); renderAdmin(state); }
  };
  select('#sekt-prepare').onclick = () => { void mutate('runde-vorbereiten'); };
  select('#sekt-close-round').onclick = () => {
    if (confirm('Runde abschließen? Alle Endergebnisse müssen vorliegen.')) void mutate('runde-abschliessen', { confirm: true });
  };
  select('#sekt-finish').onclick = () => {
    if (confirm('Turnier abschließen und den Endstand festhalten?')) void mutate('abschliessen', { confirm: true });
  };
  const reset = (action: string) => {
    const reason = prompt('Bitte einen Grund für die neue Vorbereitung angeben.');
    if (reason?.trim()) void mutate(action, { confirm: true, reason });
  };
  select('#sekt-redraw').onclick = () => reset('runde-neu');
  select('#sekt-discard').onclick = () => reset('runde-verwerfen');
  select('#sekt-delete').onclick = () => {
    if (confirm('Das gesamte Turnier in den Papierkorb verschieben?')) void mutate('loeschen', { confirm: true });
  };
  select('#sekt-restore').onclick = () => {
    if (confirm('Turnier wiederherstellen?')) void mutate('wiederherstellen', { confirm: true });
  };
  draw.onsubmit = event => {
    event.preventDefault();
    if (confirm('Diese Zuordnung verbindlich auslosen? Die gewerteten Einsätze stehen danach fest.')) {
      void mutate('runde-auslosen', { games: field<HTMLInputElement>(draw, 'games').valueAsNumber, players: rowsForDraw() });
    }
  };
  settings.onsubmit = event => {
    event.preventDefault();
    void mutate('einstellungen', { title: field<HTMLInputElement>(settings, 'title').value,
      startsOn: field<HTMLInputElement>(settings, 'startsOn').value,
      defaultGames: field<HTMLInputElement>(settings, 'defaultGames').valueAsNumber,
      published: field<HTMLInputElement>(settings, 'published').checked });
  };
  for (const selector of ['#sekt-reuse', '#sekt-new-contact']) {
    const form = select<HTMLFormElement>(selector);
    form.onsubmit = async event => {
      event.preventDefault();
      const input = Object.fromEntries(new FormData(form));
      if (await mutate('teilnehmer', { ...input, pot: Number(input.pot) })) {
        form.reset();
        try {
          const response = await fetch('/api/meisterschaft-konten', { signal: controller.signal });
          if (response.ok) contacts = (await response.json()).players;
        } catch (error) { showError(error); }
        if (state) renderAdmin(state);
      }
    };
  }
  select<HTMLDetailsElement>('#sekt-history-panel').addEventListener('toggle', () => {
    if (select<HTMLDetailsElement>('#sekt-history-panel').open) void history().catch(showError);
  });
  const reload = actionButton('Aktuellen Stand laden', () => {
    if (!dirty || confirm('Nicht gespeicherte Eingaben verwerfen?')) { dirty = false; void refresh(true).catch(showError); }
  });
  panel.prepend(reload);
  async function start() {
    try {
      admin = !publicView && await championshipRole() === 'admin';
      if (!id) {
        const events = await api<SektEvent[]>();
        select('#sekt-list').replaceChildren(...events.map(event => {
          const link = node('a', '', 'block rounded-2xl border border-stone-200 bg-white p-5 no-underline transition-colors hover:border-orange-700');
          link.href = `?id=${encodeURIComponent(event.id)}`;
          link.append(node('h2', event.title, 'text-xl font-bold text-[#173a2e]'),
            node('p', `${event.starts_on.split('-').reverse().join('.')} · ${event.deleted_at ? 'Gelöscht' : { draft: 'Entwurf', active: 'Laufend', finished: 'Abgeschlossen' }[event.status]}`, 'mt-2 text-sm text-slate-600'));
          return link;
        }));
        message.textContent = events.length ? '' : 'Derzeit sind keine Sekturniere veröffentlicht.';
        if (admin) {
          const link = node('a', 'Sekturnier anlegen', button.primary);
          link.href = '/meisterschaften/admin/?typ=sekt'; message.append(link);
        }
        return;
      }
      if (admin) {
        const response = await fetch('/api/meisterschaft-konten', { signal: controller.signal });
        if (!response.ok) throw new Error('Teilnehmerkontakte konnten nicht geladen werden.');
        contacts = (await response.json()).players;
      }
      await refresh(true);
      message.textContent = '';
      async function poll() {
        if (disposed) return;
        try { if (!document.hidden && !saving) await refresh(); }
        catch { if (!disposed) select('#sekt-refresh').textContent = 'Aktualisierung derzeit nicht möglich. Der letzte geladene Stand bleibt sichtbar.'; }
        if (!disposed) timer = setTimeout(poll, 8000);
      }
      timer = setTimeout(poll, 8000);
    } catch (error) { showError(error); }
  }
  document.addEventListener('astro:before-swap', () => {
    disposed = true;
    controller.abort();
    if (timer) clearTimeout(timer);
  }, { once: true });
  void start();
}
document.addEventListener('astro:page-load', initializeSekt);
