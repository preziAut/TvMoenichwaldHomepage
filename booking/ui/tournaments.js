export function setupTournaments(api) {
  const panel = document.getElementById('tournament-panel');
  if (!panel) return async () => {};

  const editor = document.getElementById('tournament-editor');
  const toggle = document.getElementById('new-tournament');
  const list = document.getElementById('tournament-list');
  const feedback = document.getElementById('tournament-feedback');
  let revision = 0;
  let locationHashPending = window.location.hash === '#tournament-panel';

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function editorOpen(open) {
    editor.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) editor.elements.title.focus();
  }

  function matchCard(tournament, match, admin) {
    const card = element('li', '', 'tournament-match');
    const status = element('p', match.final ? 'Ergebnis bestätigt' : match.score ? 'Zwischenstand' : 'Ausstehend', 'tournament-status');
    const score = element('strong', match.score?.join(' : ') ?? '–', 'tournament-score');
    card.append(status, element('h4', match.home + ' gegen ' + match.away), score);
    if (!admin) return card;

    const form = element('form', '', 'match-editor');
    for (const [index, side] of [match.home, match.away].entries()) {
      const label = element('label', 'Spiele · ' + side);
      const input = element('input');
      Object.assign(input, { type: 'number', min: '0', max: '7', required: true,
        name: index === 0 ? 'home' : 'away', value: String(match.score?.[index] ?? 0) });
      label.append(input);
      form.append(label);
    }
    for (const [name, label] of [['live', 'Zwischenstand speichern'], ['final', 'Ergebnis bestätigen']]) {
      const button = element('button', label);
      button.value = name;
      form.append(button);
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const buttons = [...form.querySelectorAll('button')];
      buttons.forEach(button => button.disabled = true);
      const request = revision;
      const final = event.submitter?.value === 'final';
      try {
        const saved = await api('/api/tournaments/' + tournament.id + '/matches/' + match.id, 'POST', {
          home: form.elements.home.valueAsNumber, away: form.elements.away.valueAsNumber, final,
        });
        if (request !== revision) return;
        score.textContent = saved.score.join(' : ');
        status.textContent = saved.final ? 'Ergebnis bestätigt' : 'Zwischenstand';
        feedback.textContent = saved.final ? 'Ergebnis bestätigt.' : 'Zwischenstand gespeichert.';
      } catch (error) {
        if (request === revision) feedback.textContent = error.message;
      } finally {
        buttons.forEach(button => button.disabled = false);
      }
    });
    card.append(form);
    return card;
  }

  async function load(role, location) {
    const request = ++revision;
    panel.hidden = true;
    editorOpen(false);
    editor.reset();
    feedback.textContent = '';
    const tournaments = await api('/api/tournaments');
    if (request !== revision) return;
    document.getElementById('tournament-location').textContent = location.split(' · ')[0];
    const admin = role === 'admin';
    toggle.hidden = !admin;
    list.replaceChildren(...tournaments.map(tournament => {
      const article = element('article', '', 'tournament-card');
      const matches = element('ul');
      matches.append(...tournament.matches.map(match => matchCard(tournament, match, admin)));
      article.append(element('p', tournament.format === 'mixed' ? 'Mixed-Doppel' : 'Einzelmeisterschaft', 'eyebrow'),
        element('h3', tournament.title), matches);
      return article;
    }));
    if (!tournaments.length) list.append(element('p', 'Für diesen Verein sind noch keine Turniere angelegt.', 'tournament-empty'));
    panel.hidden = false;
    if (locationHashPending) {
      locationHashPending = false;
      panel.scrollIntoView();
    }
  }

  toggle.addEventListener('click', () => editorOpen(editor.hidden));
  editor.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter;
    const request = revision;
    submit.disabled = true;
    try {
      await api('/api/tournaments', 'POST', Object.fromEntries(new FormData(editor)));
      if (request !== revision) return;
      await load('admin', document.getElementById('tournament-location').textContent);
      feedback.textContent = 'Turnier angelegt und Spielplan erstellt.';
      toggle.focus();
    } catch (error) {
      if (request === revision) feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  return load;
}
