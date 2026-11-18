import type { Slot } from '../../booking/src/website.ts';
type Calendar = {
  courts: { id: string; name: string }[];
  allocations: { id: string; courtId: string; kind: 'booking' | 'block'; startsAt: string; endsAt: string;
    ownedByMe: boolean; cancellationDeadline: string | null }[];
  slots: Slot[];
  policy: { revision: number; slotMinutes: number; maxDurationMinutes: number; advanceDays: number;
    cancellationEnabled: boolean; cancellationSeconds: number };
  role: 'admin' | 'member';
  mode: 'live' | 'pilot';
};

const site = new URLSearchParams(location.search).get('standort');
const day = document.querySelector<HTMLInputElement>('#booking-day')!;
const duration = document.querySelector<HTMLSelectElement>('#booking-duration')!;
const title = document.querySelector('#booking-title')!;
const statusMessage = document.querySelector('#booking-status')!;
const login = document.querySelector<HTMLElement>('#booking-login')!;
const controls = document.querySelector<HTMLElement>('#booking-controls')!;
const courts = document.querySelector<HTMLElement>('#booking-courts')!;
const form = document.querySelector<HTMLFormElement>('#booking-policy')!;
const enabled = form.querySelector<HTMLInputElement>('[name=enabled]')!;
const seconds = form.querySelector<HTMLInputElement>('[name=seconds]')!;
const messages: Record<string, string> = {
  LOGIN_REQUIRED: 'Bitte melde dich mit deinem Vereinskonto an.',
  FORBIDDEN: 'Dein Vereinskonto ist für diesen Standort noch nicht freigeschaltet.',
  BOOKING_DISABLED: 'Die neue Platzbuchung ist an diesem Standort derzeit geschlossen.',
  BOOKING_UNAVAILABLE: 'Der Buchungskalender ist vorübergehend nicht erreichbar.',
  SLOT_TAKEN: 'Dieser Zeitraum ist inzwischen belegt.',
  CANCELLATION_CLOSED: 'Die Frist für die Selbststornierung ist abgelaufen.',
  OUTSIDE_BOOKING_WINDOW: 'Dieser Zeitraum liegt außerhalb des Buchungsfensters.',
  POLICY_CHANGED: 'Die Regeln wurden inzwischen geändert. Bitte prüfe die neuen Werte.',
  BOOKING_LIMIT: 'Du hast die Höchstzahl aktiver Buchungen erreicht.',
};
let calendar: Calendar | undefined;
let loadId = 0;
let saving = false;
const requestKeys = new Map<string, string>();

async function request<T>(path: string, method = 'GET', data?: object): Promise<T> {
  const response = await fetch(`/api/platzbuchung/${site}/${path}`, {
    method, ...(data && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function showError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  statusMessage.textContent = messages[code] ?? 'Die Anfrage konnte nicht verarbeitet werden.';
  login.hidden = code !== 'LOGIN_REQUIRED';
}

async function save(path: string, method: string, data: object, success: string) {
  if (saving) return false;
  saving = true;
  courts.inert = true;
  controls.inert = true;
  form.inert = true;
  try {
    await request(path, method, data);
    await load();
    if (calendar) statusMessage.textContent = success;
    return true;
  } catch (error) {
    await load();
    showError(error);
    return false;
  } finally {
    saving = false;
    controls.inert = false;
    courts.inert = false;
    form.inert = false;
  }
}

function action(label: string, onClick: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = 'min-h-11 rounded-lg bg-orange-700 px-3 py-2 text-sm font-bold text-white hover:bg-orange-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-800';
  button.onclick = onClick;
  return button;
}

function render() {
  if (!calendar) return;
  const { slots, allocations, mode, policy } = calendar;
  const fragments = calendar.courts.map(court => {
    const card = document.createElement('section');
    card.className = 'min-w-0 rounded-2xl border border-stone-200 bg-white p-4 sm:p-5';
    const heading = document.createElement('h2');
    heading.className = 'mb-3 text-xl font-bold';
    heading.textContent = court.name;
    card.append(heading);
    const list = document.createElement('ul');
    const reserved = allocations.filter(item => item.courtId === court.id);
    const shownCancellations = new Set<string>();
    for (const slot of slots) {
      const row = document.createElement('li');
      row.className = 'flex min-h-12 items-center justify-between gap-2 border-t border-stone-200 py-1 text-sm';
      const time = document.createElement('span');
      time.textContent = slot.label;
      row.append(time);
      const occupant = reserved.find(item => item.startsAt < slot.endsAt && item.endsAt > slot.startsAt);
      const end = new Date(Date.parse(slot.startsAt) + Number(duration.value) * 60000).toISOString();
      const bookable = Date.parse(slot.startsAt) > Date.now() &&
        Date.parse(slot.startsAt) <= Date.now() + policy.advanceDays * 86400000 &&
        slots.some(candidate => candidate.endsAt === end) &&
        !reserved.some(item => item.startsAt < end && item.endsAt > slot.startsAt);
      if (occupant?.ownedByMe && occupant.kind === 'booking' && occupant.cancellationDeadline &&
          Date.parse(occupant.cancellationDeadline) >= Date.now() && Date.parse(occupant.startsAt) > Date.now() &&
          !shownCancellations.has(occupant.id)) {
        shownCancellations.add(occupant.id);
        row.append(action('Stornieren', () => {
          if (confirm(`${court.name} · ${slot.label} stornieren?`))
            void save(`buchungen/${occupant.id}`, 'DELETE', {}, 'Buchung storniert.');
        }));
      } else if (occupant) {
        row.append(occupant.ownedByMe && occupant.kind === 'booking' ? 'Deine Buchung' :
          occupant.kind === 'block' ? 'Gesperrt' : 'Belegt');
      } else if (bookable) {
        row.append(action('Buchen', () => {
          if (!confirm(`${court.name} · ${slot.label} für ${duration.value} Minuten ${mode === 'pilot' ? 'testweise ' : ''}buchen?`)) return;
          const key = `${court.id}:${slot.startsAt}:${end}`;
          const requestKey = requestKeys.get(key) ?? crypto.randomUUID();
          requestKeys.set(key, requestKey);
          void save('buchungen', 'POST', { courtId: court.id, startsAt: slot.startsAt, endsAt: end, requestKey },
            mode === 'pilot' ? 'Testbuchung gespeichert.' : 'Platz gebucht.').then(ok => { if (ok) requestKeys.delete(key); });
        }));
      } else row.append('Nicht buchbar');
      list.append(row);
    }
    card.append(list);
    return card;
  });
  courts.replaceChildren(...fragments);
}

async function load() {
  const current = ++loadId;
  calendar = undefined;
  courts.replaceChildren();
  form.hidden = true;
  statusMessage.textContent = 'Kalender wird geladen …';
  try {
    const result = await request<Calendar>(`kalender?tag=${encodeURIComponent(day.value)}`);
    if (current !== loadId) return;
    calendar = result;
    login.hidden = true;
    controls.hidden = false;
    const previous = duration.value;
    const choices = [];
    for (let minutes = result.policy.slotMinutes; minutes <= result.policy.maxDurationMinutes; minutes += result.policy.slotMinutes)
      choices.push(new Option(`${minutes} Minuten`, String(minutes)));
    duration.replaceChildren(...choices);
    if (choices.some(option => option.value === previous)) duration.value = previous;
    form.hidden = result.role !== 'admin';
    enabled.checked = result.policy.cancellationEnabled;
    seconds.value = String(result.policy.cancellationSeconds);
    statusMessage.textContent = result.mode === 'pilot' ? 'Pilotbetrieb · Reservierungen hier gelten nur als Test.' :
      result.slots.length ? 'Alle Zeiten gelten für Österreich.' : 'Für diesen Tag sind keine Buchungszeiten eingerichtet.';
    render();
  } catch (error) { if (current === loadId) showError(error); }
}

if (site === 'moenichwald' || site === 'waldbach') {
  title.textContent = `Platzbuchung ${site === 'moenichwald' ? 'Mönichwald' : 'Waldbach'}`;
  login.querySelector('a')!.href = `/meisterschaften/anmelden/?buchung=${site}`;
  day.value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  day.addEventListener('change', () => { if (day.value) void load(); });
  duration.addEventListener('change', render);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (calendar) {
      void save('regeln', 'POST', { revision: calendar.policy.revision, cancellationEnabled: enabled.checked,
        cancellationSeconds: seconds.valueAsNumber }, 'Stornierungsregeln gespeichert.');
    }
  });
  void load();
} else statusMessage.textContent = 'Bitte wähle zuerst einen Standort aus.';
