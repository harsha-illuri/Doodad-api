import { describe, expect, it } from 'vitest';

import { type Env, handle } from '../src/index';

/** D1, as far as the Worker uses it: each statement and what was bound to it. */
function fakeDb(fail = false) {
  const runs: { sql: string; args: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: () => {
          if (fail) return Promise.reject(new Error('down'));
          runs.push({ sql: sql.replace(/\s+/g, ' ').trim(), args });
          return Promise.resolve({ success: true });
        },
      }),
    }),
  };
  return { env: { DB: db } as unknown as Env, runs };
}

const NOW = new Date('2026-11-16T15:30:00Z');
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://api.thedoodad.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const app = { version: '0.1.0', channel: 'beta' };
const platform = { os: 'mac', osMajor: '26', arch: 'arm64' };
const install = { schema: 1, installWeek: '2026-W47', app, platform };
const feedback = {
  schema: 1,
  kind: 'feedback',
  app,
  platform,
  hardwareTier: { memory: '16GB', gpu: 'metal' },
  note: 'I love the plant one.',
  details: [],
};

describe('the receiving service', () => {
  it('counts an install, by day, version and kind of computer, and keeps nothing else', async () => {
    const { env, runs } = fakeDb();
    const res = await handle(
      post('/v1/install', install, { 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'Doodad' }),
      env,
      NOW,
    );
    expect(res.status).toBe(202);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.sql).toMatch(/^INSERT INTO installs .* DO UPDATE SET count = count \+ 1$/);
    expect(runs[0]!.args).toEqual(['2026-11-16', '2026-W47', '0.1.0', 'beta', 'mac', '26', 'arm64']);
    // Never the IP or the user agent, anywhere.
    expect(JSON.stringify(runs)).not.toMatch(/203\.0\.113\.9|User-Agent|Doodad"/);
  });

  it('keeps feedback as it was checked, by the day it came, not the time', async () => {
    const { env, runs } = fakeDb();
    expect((await handle(post('/v1/report', feedback), env, NOW)).status).toBe(202);
    expect(runs[0]!.args.slice(0, 3)).toEqual(['2026-11-16', 'feedback', '0.1.0']);
    expect(JSON.parse(runs[0]!.args[3] as string)).toEqual(feedback);
  });

  it('turns away anything that isn’t allowed, and keeps none of it', async () => {
    const { env, runs } = fakeDb();
    const turnedAway = [
      post('/v1/install', { ...install, id: 'abc123' }),
      post('/v1/install', { ...install, hardwareTier: feedback.hardwareTier }),
      post('/v1/report', { ...feedback, chat: 'what I asked' }),
      post('/v1/report', 'not json'),
      post('/v1/install', install, { 'Content-Type': 'text/plain' }),
    ];
    for (const request of turnedAway) expect((await handle(request, env, NOW)).status).toBe(400);
    expect(runs).toEqual([]);
  });

  it('turns away what’s too big, wrong paths, and anything but POST', async () => {
    const { env, runs } = fakeDb();
    expect((await handle(post('/v1/install', 'x'.repeat(3000)), env, NOW)).status).toBe(413);
    expect((await handle(post('/v1/chats', install), env, NOW)).status).toBe(404);
    expect(
      (await handle(new Request('https://api.thedoodad.com/v1/install'), env, NOW)).status,
    ).toBe(405);
    expect(runs).toEqual([]);
  });

  it('says to try again later when it can’t keep it, and answers a health check', async () => {
    expect((await handle(post('/v1/install', install), fakeDb(true).env, NOW)).status).toBe(503);
    expect(
      (await handle(new Request('https://api.thedoodad.com/health'), fakeDb().env, NOW)).status,
    ).toBe(200);
  });
});
