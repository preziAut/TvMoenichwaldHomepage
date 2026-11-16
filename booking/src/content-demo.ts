export function createContentDemo() {
  type Event = { id: string; title: string; date: string; description: string; published: boolean };
  type Photo = { id: string; caption: string; url: string };
  const clubs = new Map<string, { events: Event[]; photos: Photo[] }>();

  return (club: string, admin: boolean, path: string, method: string, body: Record<string, unknown>) => {
    if (!path.startsWith('/api/club-content')) return undefined;
    const content = clubs.get(club) ?? { events: [], photos: [] };
    clubs.set(club, content);
    const reply = (value: unknown, status = 200) => Response.json(value, { status });
    if (path === '/api/club-content' && method === 'GET') {
      return reply({ ...content, events: content.events.filter(event => admin || event.published) });
    }
    if (!admin) return reply({ error: 'FORBIDDEN' }, 403);
    if (path === '/api/club-content/events' && method === 'POST') {
      const { id, title, date, description, published } = body;
      if (typeof title !== 'string' || !title.trim() || title.length > 120 ||
          typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date ||
          typeof description !== 'string' || description.length > 2000 || typeof published !== 'boolean') {
        return reply({ error: 'INVALID_CONTENT' }, 400);
      }
      const existing = content.events.findIndex(event => event.id === id);
      if (id && existing < 0) return reply({ error: 'NOT_FOUND' }, 404);
      const event = { id: existing < 0 ? crypto.randomUUID() : content.events[existing].id,
        title: title.trim(), date, description, published };
      if (existing < 0) content.events.push(event);
      else content.events[existing] = event;
      return reply(event);
    }
    if (path === '/api/club-content/photos' && method === 'POST') {
      const { image, caption } = body;
      if (!(image instanceof Blob) || image.size < 1 || image.size > 8_000_000 ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(image.type) ||
          typeof caption !== 'string' || !caption.trim() || caption.length > 180 || content.photos.length >= 20) {
        return reply({ error: 'INVALID_CONTENT' }, 400);
      }
      const photo = { id: crypto.randomUUID(), caption: caption.trim(), url: URL.createObjectURL(image) };
      content.photos.push(photo);
      return reply(photo, 201);
    }
    const id = path.split('/').at(-1);
    if (method === 'DELETE' && path.startsWith('/api/club-content/events/')) {
      content.events = content.events.filter(event => event.id !== id);
      return reply({ ok: true });
    }
    if (method === 'DELETE' && path.startsWith('/api/club-content/photos/')) {
      const photo = content.photos.find(photo => photo.id === id);
      if (photo) URL.revokeObjectURL(photo.url);
      content.photos = content.photos.filter(photo => photo.id !== id);
      return reply({ ok: true });
    }
    return reply({ error: 'NOT_FOUND' }, 404);
  };
}
