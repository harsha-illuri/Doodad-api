/**
 * Doodad's receiving service (the Doodad repo's docs/27, D115, D131): a
 * Cloudflare Worker that takes the reports the app sends, checks each one
 * against the same allowlist the app does (src/schema.ts), and keeps it in
 * D1. Installs are only ever counted.
 *
 * It never reads the request's IP, user agent, or Cloudflare's location
 * headers: only the path, the method, the content type, and the body.
 *
 * Answers, as the app expects: 2xx kept; 400 doesn't pass (the app drops
 * it); 404/405 unknown; 413 too big (dropped); 5xx try again later.
 */
import { ENDPOINTS, MAX_BYTES, SCHEMAS, type TelemetryKind } from './schema';

export interface Env {
  readonly DB: D1Database;
}

const KIND_BY_PATH = new Map(
  (Object.entries(ENDPOINTS) as [TelemetryKind, string][]).map(([kind, path]) => [path, kind]),
);

const answer = (status: number, message: string): Response =>
  new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** Today in UTC, as YYYY-MM-DD: days, never times, so nothing lines up with one person's moment. */
const today = (now: Date): string => now.toISOString().slice(0, 10);

/** Keep a checked report. */
async function keep(env: Env, kind: TelemetryKind, body: unknown, now: Date): Promise<void> {
  const day = today(now);
  const text = JSON.stringify(body);
  switch (kind) {
    case 'install': {
      const b = SCHEMAS.install.parse(body);
      await env.DB.prepare(
        `INSERT INTO installs (day, week, version, channel, os, os_major, arch, count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (day, week, version, channel, os, os_major, arch)
         DO UPDATE SET count = count + 1`,
      )
        .bind(day, b.installWeek, b.app.version, b.app.channel, b.platform.os, b.platform.osMajor, b.platform.arch)
        .run();
      return;
    }
    case 'report': {
      const b = SCHEMAS.report.parse(body);
      await env.DB.prepare('INSERT INTO reports (received, kind, version, body) VALUES (?, ?, ?, ?)')
        .bind(day, b.kind, b.app.version, text)
        .run();
      return;
    }
    case 'usage': {
      const b = SCHEMAS.usage.parse(body);
      await env.DB.prepare('INSERT INTO usage_reports (received, week, body) VALUES (?, ?, ?)')
        .bind(day, b.week, text)
        .run();
      return;
    }
    case 'donation':
      await env.DB.prepare('INSERT INTO donations (received, body) VALUES (?, ?)').bind(day, text).run();
      return;
    case 'incident': {
      const b = SCHEMAS.incident.parse(body);
      await env.DB.prepare('INSERT INTO incidents (received, kind, body) VALUES (?, ?, ?)')
        .bind(day, b.kind, text)
        .run();
      return;
    }
  }
}

export async function handle(request: Request, env: Env, now = new Date()): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/health') return answer(200, 'ok');
  const kind = KIND_BY_PATH.get(pathname);
  if (kind === undefined) return answer(404, 'Not here.');
  if (request.method !== 'POST') return answer(405, 'POST only.');
  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/json')) {
    return answer(400, 'JSON only.');
  }
  // Read no more than the kind allows, whatever Content-Length says.
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BYTES[kind]) return answer(413, 'Too big.');
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return answer(400, 'Not JSON.');
  }
  const checked = SCHEMAS[kind].safeParse(body);
  if (!checked.success) return answer(400, 'It has something in it that isn’t allowed.');
  try {
    await keep(env, kind, checked.data, now);
  } catch {
    return answer(503, 'Not kept. Try again later.');
  }
  return answer(202, 'Kept.');
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
} satisfies ExportedHandler<Env>;
