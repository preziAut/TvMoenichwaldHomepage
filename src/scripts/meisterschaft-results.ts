import { championshipButton } from './meisterschaft-buttons.ts';
import { validateScore } from '../../championships/domain/competition.ts';

type Score = [number, number][];
export type AdminMatch = {
  id: string; phase: number; home_name: string | null; away_name: string | null; score: Score | null;
  status: string; version: number; editable: number; correctable?: number; proposal: string | null;
};

const labels: Record<string, string> = { open: 'Offen', submitted: 'Gemeldet', disputed: 'Strittig', confirmed: 'Bestätigt', completed: 'Abgeschlossen' };
const buttonClass = championshipButton.primary;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, classes = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = classes;
  return node;
}

export function resultCard(match: AdminMatch, refresh: () => Promise<void>) {
  const card = element('article', '', 'min-w-0 rounded-xl border border-[#d9dbd0] p-4');
  card.dataset.match = match.id;
  const names = [match.home_name ?? 'Noch offen', match.away_name ?? 'Noch offen'];
  const heading = element('h3', names.join(' – '), 'break-words font-bold');
  heading.tabIndex = -1;
  card.append(heading, element('p', `${match.phase === 1 ? 'Vorrunde' : 'Folgephase'} · ${labels[match.status] ?? match.status}`, 'mt-1 text-sm'));
  const proposed = match.proposal ? JSON.parse(match.proposal) as Score : null;
  const shown = match.score ?? proposed;
  if (shown) card.append(element('p', shown.map(set => set.join(':')).join(', '), 'mt-2 font-semibold'));
  if ((!match.editable && !match.correctable) || !match.home_name || !match.away_name || match.status === 'completed') return card;

  const form = element('form', '', 'mt-4 grid gap-3');
  form.method = 'post';
  if (!match.editable && match.phase === 1) {
    form.append(element('p', 'Die Gruppentabelle wird neu berechnet. Gespielte Folgepartien behalten ihre Paarungen.', 'text-sm text-[#4c5d52]'));
  }
  const message = element('p', '', 'text-sm');
  message.setAttribute('role', 'status');
  const correction = match.status !== 'open';
  const sets: HTMLInputElement[][] = [];
  for (let number = 0; number < 3; number++) {
    const field = element('fieldset', '', 'min-w-0');
    field.append(element('legend', `Satz ${number + 1}${number === 2 ? ' (falls nötig)' : ''}`, 'mb-1 text-sm font-semibold'));
    const inputs = element('div', '', 'grid grid-cols-2 gap-2');
    sets.push(names.map((name, side) => {
      const label = element('label', name, 'mb-0 min-w-0 break-words');
      const input = element('input', '', 'min-h-11 rounded-lg');
      input.setAttribute('aria-label', `Satz ${number + 1}: ${name}`);
      input.type = 'number'; input.inputMode = 'numeric'; input.min = '0'; input.max = '7';
      input.value = shown?.[number]?.[side]?.toString() ?? '';
      label.append(input); inputs.append(label); return input;
    }));
    field.append(inputs); form.append(field);
  }
  const reasonLabel = element('label', 'Grund der Korrektur');
  const reason = element('input', '', 'rounded-lg');
  reason.maxLength = 500;
  reasonLabel.append(reason);
  if (correction) form.append(reasonLabel);
  const save = element('button', correction ? 'Ergebnis korrigieren' : 'Ergebnis speichern', buttonClass);
  form.append(save);
  if (proposed) {
    const confirm = element('button', 'Gemeldetes Ergebnis bestätigen', championshipButton.secondary);
    confirm.type = 'button';
    confirm.onclick = () => void send('bestaetigen', 'POST', {}, confirm);
    form.append(confirm);
  }
  async function send(action: string, method: string, payload: object, button: HTMLButtonElement) {
    if (form.getAttribute('aria-busy') === 'true') return;
    form.setAttribute('aria-busy', 'true');
    button.disabled = true;
    message.textContent = '';
    try {
      const response = await fetch(`/api/spiele/${encodeURIComponent(match.id)}/${action}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: match.version, ...payload }),
      });
      const output = await response.json();
      if (!response.ok) throw new Error(output.error ?? 'Ergebnis konnte nicht gespeichert werden.');
      await refresh();
      const updated = document.querySelector<HTMLElement>(`[data-match="${CSS.escape(match.id)}"]`);
      updated?.querySelector('h3')?.focus();
    } catch (error) { message.textContent = error instanceof Error ? error.message : 'Speichern fehlgeschlagen.'; }
    finally { form.removeAttribute('aria-busy'); button.disabled = false; }
  }
  form.onsubmit = event => {
    event.preventDefault();
    const entered = sets.filter(set => set.some(input => input.value !== ''));
    if (entered.some(set => set.some(input => input.value === '')) || entered.some((set, i) => set !== sets[i])) {
      message.textContent = 'Bitte die Satzstände der Reihe nach vollständig eingeben.'; return;
    }
    const score = entered.map(set => set.map(input => Number(input.value)) as [number, number]);
    try { validateScore(score); }
    catch { message.textContent = 'Bitte ein vollständiges Ergebnis mit zwei gültigen Gewinnsätzen eingeben.'; return; }
    if (correction && !reason.value.trim()) { message.textContent = 'Bitte begründe die Korrektur.'; reason.focus(); return; }
    void send(correction ? 'admin-korrektur' : 'ergebnis', correction ? 'PATCH' : 'POST', { score, reason: reason.value.trim() }, save);
  };
  form.append(message);
  if (!match.editable && match.correctable) {
    const edit = element('details', '', 'mt-3 border-t border-[#d9dbd0] pt-3');
    edit.append(element('summary', 'Korrektur öffnen', 'cursor-pointer text-sm font-semibold underline underline-offset-4'), form);
    card.append(edit);
  } else card.append(form);
  return card;
}
