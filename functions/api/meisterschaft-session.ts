import { championshipSessions } from '../../championships/server/sessions.ts';

export async function onRequestGet({ request, env }: { request: Request; env: { DB?: Parameters<typeof championshipSessions>[0] } }) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!env.DB) return Response.json({ role: null }, { status: 503, headers });
  try {
    const actor = await championshipSessions(env.DB).read(request);
    return Response.json({ role: actor?.role ?? null }, { headers });
  } catch {
    return Response.json({ role: null }, { status: 503, headers });
  }
}
