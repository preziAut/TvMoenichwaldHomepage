const panel = document.getElementById('club-content');

export function setupContentDemo(api, notice) {
  if (!panel) return async () => {};
  const get = id => document.getElementById(id);
  const editor = get('event-editor');
  const photoEditor = get('photo-editor');
  let editing;
  let currentRole;
  let version = 0;
  let identityVersion = 0;

  function reset() {
    editor.reset();
    editing = undefined;
    get('event-form-title').textContent = 'Termin anlegen';
  }

  function element(tag, value) {
    const result = document.createElement(tag);
    if (value !== undefined) result.textContent = value;
    return result;
  }

  function action(label, callback) {
    const button = element('button', label);
    button.type = 'button';
    button.addEventListener('click', () => run(button, callback));
    return button;
  }

  async function run(button, callback) {
    button.disabled = true;
    try {
      await callback();
    } catch (error) {
      notice(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function render() {
    const request = ++version;
    const { events, photos } = await api('/api/club-content');
    if (request !== version) return;
    const admin = currentRole === 'admin';
    const eventRows = events.sort((a, b) => a.date.localeCompare(b.date)).map(event => {
      const item = element('li');
      const date = event.date.split('-').reverse().join('.');
      item.append(element('strong', date + ' · ' + event.title));
      if (!event.published) item.append(element('p', 'Entwurf'));
      if (event.description) item.append(element('p', event.description));
      if (admin) item.append(action('Bearbeiten', () => {
        editing = event.id;
        get('event-form-title').textContent = 'Termin bearbeiten';
        get('event-title').value = event.title;
        get('event-date').value = event.date;
        get('event-description').value = event.description;
        get('event-public').checked = event.published;
        get('event-title').focus();
      }), action('Entfernen', async () => {
        await api('/api/club-content/events/' + event.id, 'DELETE', {});
        if (editing === event.id) reset();
        await render();
      }));
      return item;
    });
    get('club-events').replaceChildren(...(eventRows.length ? eventRows : [element('li', 'Keine Termine vorhanden.')]));
    const photoRows = photos.map(photo => {
      const item = element('li');
      const image = element('img');
      image.src = photo.url;
      image.alt = photo.caption;
      image.loading = 'lazy';
      item.append(image, element('p', photo.caption));
      if (admin) item.append(action('Bild entfernen', async () => {
        await api('/api/club-content/photos/' + photo.id, 'DELETE', {});
        await render();
      }));
      return item;
    });
    get('club-photos').replaceChildren(...(photoRows.length ? photoRows : [element('li', 'Keine Bilder vorhanden.')]));
    panel.hidden = false;
  }

  get('event-reset').addEventListener('click', reset);
  editor.addEventListener('submit', event => {
    event.preventDefault();
    run(event.submitter, async () => {
      await api('/api/club-content/events', 'POST', {
        id: editing, title: get('event-title').value, date: get('event-date').value,
        description: get('event-description').value, published: get('event-public').checked,
      });
      reset();
      await render();
      notice('Termin gespeichert.');
    });
  });
  photoEditor.addEventListener('submit', event => {
    event.preventDefault();
    run(event.submitter, async () => {
      const image = get('photo-file').files[0];
      if (!image || image.size > 8_000_000) throw new Error('Bitte wähle ein Bild bis 8 MB.');
      const identity = identityVersion;
      const caption = get('photo-caption').value;
      const bitmap = await createImageBitmap(image).catch(() => {
        throw new Error('Das Bild konnte nicht geöffnet werden.');
      });
      bitmap.close();
      if (identity !== identityVersion) return;
      await api('/api/club-content/photos', 'POST', { image, caption });
      photoEditor.reset();
      await render();
      notice('Bild zur Demogalerie hinzugefügt.');
    });
  });

  return async role => {
    identityVersion++;
    currentRole = role;
    reset();
    photoEditor.reset();
    editor.hidden = photoEditor.hidden = role !== 'admin';
    panel.hidden = true;
    await render();
  };
}
