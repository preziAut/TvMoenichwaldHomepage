type Role = 'admin' | 'member' | null;
let current: Promise<Role> | undefined;

/** Reuse one checked session during a page visit. Navigation starts a fresh check. */
export function championshipRole(refresh = false): Promise<Role> {
  if (refresh || !current) {
    current = fetch('/api/meisterschaft-session', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Die Anmeldung konnte nicht geprüft werden.');
      const { role } = await response.json();
      return role === 'admin' || role === 'member' ? role : null;
    });
  }
  return current;
}
