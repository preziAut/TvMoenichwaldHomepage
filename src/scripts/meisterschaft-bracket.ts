export type BracketMatch = {
  round: number;
  position: number;
  home: string | null;
  away: string | null;
  winner: string | null;
  score?: [number, number][] | null;
};

export const bracketRound = (distanceFromFinal: number) => ['Finale', 'Halbfinale', 'Viertelfinale'][distanceFromFinal] ?? 'K.-o.-Runde';

export function renderBracket(matches: BracketMatch[], names: Map<string, string>) {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string, classes: string) => {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = classes;
    return element;
  };
  const last = Math.max(...matches.map(match => match.round));
  const panel = node('div', '', 'min-w-0 rounded-2xl border border-[#d9dbd0] bg-[#f5f3ec] p-4 sm:p-6');
  panel.append(node('p', 'Auf kleinen Bildschirmen kannst du den Turnierbaum seitlich verschieben.', 'mb-3 text-sm text-[#4c5d52] md:hidden'));
  const scroll = node('div', '', 'overflow-x-auto rounded-lg');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'K.-o.-Turnierbaum');
  const grid = node('div', '', 'grid gap-x-8');
  grid.style.gridTemplateColumns = `repeat(${last}, minmax(13rem, 1fr))`;
  const card = (match: BracketMatch) => {
    const box = node('div', '', 'relative z-10 divide-y divide-[#e9ece0] rounded-lg border border-[#d9dbd0] bg-white text-sm');
    if (match.score) box.append(node('span', `Ergebnis ${match.score.map(set => set.join(':')).join(', ')}`, 'sr-only'));
    for (const [side, player] of [match.home, match.away].entries()) {
      const won = player !== null && player === match.winner;
      const line = node('div', '', `grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 ${won ? 'bg-[#e9ece0] font-bold' : ''}`);
      const pending = match.round === 1 && match.winner ? 'Freilos' : 'Noch offen';
      line.append(node('span', player ? (names.get(player) ?? player) : pending, 'break-words'),
        node('span', match.score?.map(set => set[side]).join('   ') ?? '', 'whitespace-pre tabular-nums'));
      if (won) line.firstElementChild!.append(node('span', ' (Sieger)', 'sr-only'));
      box.append(line);
    }
    return box;
  };
  for (let round = 1; round <= last; round++) {
    const column = node('section', '', 'min-w-0');
    column.append(node('h4', bracketRound(last - round), 'mb-3 text-sm font-bold tracking-wide text-[#173a2e]'));
    const lane = node('div', '', 'grid');
    lane.style.gridTemplateRows = `repeat(${2 ** (last - 1)}, minmax(5.75rem, auto))`;
    const span = 2 ** (round - 1);
    for (const match of matches.filter(match => match.round === round && (round !== last || match.position === 1))) {
      const slot = node('div', '', 'relative flex min-w-0 flex-col justify-center');
      slot.style.gridRow = `${(match.position - 1) * span + 1} / span ${span}`;
      if (round > 1) slot.append(node('span', '', 'pointer-events-none absolute top-1/2 -left-4 w-4 border-t border-[#94a298]'));
      if (round < last) {
        slot.append(node('span', '', 'pointer-events-none absolute top-1/2 -right-4 w-4 border-t border-[#94a298]'),
          node('span', '', `pointer-events-none absolute -right-4 h-1/2 border-r border-[#94a298] ${match.position % 2 ? 'top-1/2' : 'top-0'}`));
      }
      slot.append(card(match));
      lane.append(slot);
    }
    column.append(lane);
    grid.append(column);
  }
  scroll.append(grid);
  panel.append(scroll);
  const bronze = matches.find(match => match.round === last && match.position === 2);
  if (bronze) {
    const section = node('section', '', 'mt-5 max-w-xs');
    section.append(node('h4', 'Spiel um Platz 3', 'mb-2 text-sm font-bold'), card(bronze));
    panel.append(section);
  }
  return panel;
}
