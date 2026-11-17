// Copied from the Doodad repo's packages/telemetry/src/index.ts by
// scripts/sync-schema.mjs. Don't edit here: change it there, then run
// `pnpm sync-schema`. The app checks every report against these before
// sending, and this service checks them again.

import { z } from 'zod';

/**
 * What Doodad may send about how it's used (docs/27, D115): the allowlist.
 * The app checks every report against these before it's queued, and the
 * receiving service (its own repo) rejects anything that doesn't pass. A
 * test keeps docs/27's report catalog and WeeklyReport's fields the same.
 *
 * Nothing here may ever hold prompts or chats, records, file or folder
 * names, doodad names, hostnames doodads contact, or anything that ties a
 * report to a person (docs/27, "Never in a report").
 *
 * The contract, for the receiving service:
 *   POST <base>/v1/install    an Install (once, on first launch, unless switched off)
 *   POST <base>/v1/usage      a WeeklyReport (level 1, weekly usage stats)
 *   POST <base>/v1/report     a ProblemReport or feedback (level 2, sent by hand)
 *   POST <base>/v1/donation   a Donation (level 2, a failed change, sent by hand)
 *   POST <base>/v1/incident   an Incident (alpha diagnostics, alpha builds only)
 * JSON, `Content-Type: application/json`, no cookies, no auth. Answer 2xx
 * when kept, 400 when it doesn't pass (the app drops it), 413 when too big
 * (dropped), 429 or 5xx to be tried again later. Never store the IP or user
 * agent.
 */

export const TELEMETRY_SCHEMA = 1;

export const ENDPOINTS = {
  install: '/v1/install',
  usage: '/v1/usage',
  report: '/v1/report',
  donation: '/v1/donation',
  incident: '/v1/incident',
} as const;

export type TelemetryKind = keyof typeof ENDPOINTS;

/** The biggest body the service should accept, per kind (bytes). */
export const MAX_BYTES: Record<TelemetryKind, number> = {
  install: 2 * 1024,
  usage: 8 * 1024,
  report: 32 * 1024,
  donation: 512 * 1024,
  incident: 512 * 1024,
};

const isoWeek = z.string().regex(/^\d{4}-W\d{2}$/, 'an ISO week, like 2026-W45');
const count = z.number().int().min(0).max(100_000);

/** Counts in a few coarse groups, so combinations stay coarse. */
export const BUCKETS = ['0', '1-2', '3-5', '6-10', '11+'] as const;
export const bucket = z.enum(BUCKETS);
export function bucketOf(n: number): (typeof BUCKETS)[number] {
  return n <= 0 ? '0' : n <= 2 ? '1-2' : n <= 5 ? '3-5' : n <= 10 ? '6-10' : '11+';
}

export const channel = z.enum(['alpha', 'beta', 'stable']);
export type Channel = z.infer<typeof channel>;

const app = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z]+(\.\d+)?)?$/),
    channel,
  })
  .strict();

const platform = z
  .object({
    os: z.enum(['mac', 'win', 'linux']),
    osMajor: z.string().regex(/^\d{1,3}$/),
    arch: z.enum(['arm64', 'x64', 'other']),
  })
  .strict();

/** docs/23's tiers: memory in coarse steps and the GPU's kind, never the chip's name. */
const hardwareTier = z
  .object({
    memory: z.enum(['<8GB', '8GB', '16GB', '32GB+']),
    gpu: z.enum(['metal', 'cuda', 'vulkan', 'none']),
  })
  .strict();

/** The AI in use: one of Doodad's own models, by catalog ID, or the kind of service connected. */
const ai = z
  .string()
  .regex(/^(none|local:[a-z0-9.-]{1,40}|connected:(ollama|openai|anthropic|openrouter|other))$/);

/**
 * Doodad was installed (2026-11-16): sent once, on first launch, unless the
 * person switches it off. Which version and what kind of computer, and the
 * week: nothing else, and no ID, so one install can't be told from another
 * or followed. Counting these is how anyone knows Doodad is being installed.
 */
export const Install = z
  .object({
    schema: z.literal(TELEMETRY_SCHEMA),
    installWeek: isoWeek,
    app,
    platform,
  })
  .strict();
export type Install = z.infer<typeof Install>;

export const WeeklyReport = z
  .object({
    schema: z.literal(TELEMETRY_SCHEMA),
    week: isoWeek,
    installWeek: isoWeek,
    app,
    platform,
    hardwareTier,
    ai,
    setup: z
      .object({
        firstDoodad: z.boolean(),
        minutesToFirst: z.enum(['<5', '5-15', '15-60', '60+', 'not yet']),
        aiSetup: z.enum(['local', 'connected', 'cant-run-locally', 'not-done']),
      })
      .strict(),
    activeDays: z.number().int().min(0).max(7),
    doodads: z
      .object({
        installed: bucket,
        usedOn2Days: bucket,
        starters: bucket,
        made: bucket,
        fromFiles: bucket,
        copies: bucket,
      })
      .strict(),
    changes: z
      .object({
        proposed: count,
        made: count,
        turnedDown: count,
        undone: count,
        failed: count,
      })
      .strict(),
    data: z.object({ migrations: count, restores: count }).strict(),
    schedules: z.object({ ok: count, failed: count, missed: count }).strict(),
    permissions: z.object({ asked: count, allowed: count, declined: count }).strict(),
    sharing: z
      .object({
        shared: count,
        opened: count,
        added: count,
        copies: count,
        backups: count,
        restores: count,
      })
      .strict(),
    errors: z.object({ doodadCrashes: count, aiErrors: count, hostErrors: count }).strict(),
  })
  .strict();
export type WeeklyReport = z.infer<typeof WeeklyReport>;

/** A line of a report, already stripped of paths and this computer's names. */
const line = z.string().max(500);

/** A check from the change pipeline: its kind, outcome, and plain-words summary. */
const check = z
  .object({
    check: z.string().regex(/^[a-z-]{1,30}$/),
    outcome: z.enum(['pass', 'fail', 'needs-approval', 'needs-migration']),
    summary: line,
  })
  .strict();

/** A doodad's code, by file, before and after a change (built on sample data, never records). */
const files = z
  .object({
    before: z.record(z.string().max(200), z.string().max(200_000)),
    after: z.record(z.string().max(200), z.string().max(200_000)),
  })
  .strict();

/**
 * "Report a problem", the offer after a crash, or "Send feedback" (level 2):
 * shown in full before Send. Feedback is the person's own words, with no
 * details unless they leave them in.
 */
export const ProblemReport = z
  .object({
    schema: z.literal(TELEMETRY_SCHEMA),
    kind: z.enum(['problem', 'crash', 'feedback']),
    app,
    platform,
    hardwareTier,
    code: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .optional(),
    note: z.string().max(2000),
    replyTo: z.email().max(200).optional(),
    details: z.array(line).max(60),
  })
  .strict();
export type ProblemReport = z.infer<typeof ProblemReport>;

/** A failed change, given by hand so Doodad gets better at changes like it (level 2). */
export const Donation = z
  .object({
    schema: z.literal(TELEMETRY_SCHEMA),
    kind: z.literal('failed-change'),
    app,
    platform,
    ai,
    request: z.string().max(2000),
    checks: z.array(check).max(30),
    files,
    note: z.string().max(2000).optional(),
  })
  .strict();
export type Donation = z.infer<typeof Donation>;

/**
 * Alpha diagnostics (D115): sent by itself in alpha builds, never in any
 * other. What went wrong, with paths stripped: never the request, the chat,
 * or records.
 */
export const Incident = z
  .object({
    schema: z.literal(TELEMETRY_SCHEMA),
    kind: z.enum(['change-failed', 'doodad-crash', 'ai-error', 'host-error']),
    week: isoWeek,
    app: app.extend({ channel: z.literal('alpha') }),
    platform,
    hardwareTier,
    ai,
    code: z.string().regex(/^[a-z0-9-]{1,40}$/),
    message: line,
    checks: z.array(check).max(30).optional(),
    attempts: z.number().int().min(0).max(50).optional(),
    files: files.optional(),
  })
  .strict();
export type Incident = z.infer<typeof Incident>;

export const SCHEMAS = {
  install: Install,
  usage: WeeklyReport,
  report: ProblemReport,
  donation: Donation,
  incident: Incident,
} as const;
