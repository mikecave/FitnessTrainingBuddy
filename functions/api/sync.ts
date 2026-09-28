// POST /api/sync — the one canonical copy of the data.
//
// Protocol: full-state, last-write-wins.
//   client sends every record it has
//   -> server upserts each one, keeping whichever side has the higher updatedAt
//   -> server returns the merged state
//   -> client merges that back locally under the same rule
//
// Full state rather than deltas because the whole dataset is tens of KB, and it
// buys idempotency: syncing twice changes nothing, and a device that has been
// offline for weeks needs no special path. Every record already carries a ULID
// id and updatedAt, which is what makes the merge unambiguous.
//
// The table is deliberately generic (kind, id, updated_at, json): the client
// owns the record shapes, so adding a client-side table needs no migration here.

interface D1Result<T = unknown> {
  results: T[];
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

interface Env {
  DB: D1Database;
  SYNC_TOKEN: string;
  /** Comma-separated origins allowed to call this, e.g. your Pages URL.
   *  Set in wrangler.toml [vars]; instance config, so not in this repo. */
  ALLOWED_ORIGINS?: string;
}

interface Ctx {
  request: Request;
  env: Env;
}

/** Client record: the shape is the client's business; we only need these two. */
interface Rec {
  id: string;
  updatedAt: number;
}

const KINDS = ['exercises', 'templates', 'sessions', 'feedback'] as const;
type Kind = (typeof KINDS)[number];

/** The dev server must be able to reach the same database as production —
 *  that is the entire point — so localhost is always an allowed origin. The
 *  deployed origin comes from the ALLOWED_ORIGINS var. */
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function allowedOrigins(env: Env): string[] {
  const configured = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...configured, ...DEV_ORIGINS];
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const origins = allowedOrigins(env);
  const allowed = origin && origins.includes(origin) ? origin : origins[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) },
  });
}

/** Length-independent comparison, so a wrong token leaks nothing by timing. */
function tokenMatches(given: string, expected: string): boolean {
  if (!expected) return false;
  let diff = given.length ^ expected.length;
  for (let i = 0; i < Math.max(given.length, expected.length); i++) {
    diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function onRequestOptions({ request, env }: Ctx): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin'), env) });
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  const origin = request.headers.get('Origin');

  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!tokenMatches(token, env.SYNC_TOKEN)) {
    return json({ ok: false, error: 'Unauthorized — check the sync key.' }, 401, origin, env);
  }

  let incoming: Partial<Record<Kind, Rec[]>>;
  try {
    const body = (await request.json()) as { data?: Partial<Record<Kind, Rec[]>> };
    incoming = body.data ?? {};
  } catch {
    return json({ ok: false, error: 'Body must be JSON.' }, 400, origin, env);
  }

  // Upsert every incoming record, but only overwrite when the incoming copy is
  // strictly newer. Runs as one batch, so a half-applied sync is not possible.
  const statements: D1PreparedStatement[] = [];
  let pushed = 0;
  for (const kind of KINDS) {
    for (const rec of incoming[kind] ?? []) {
      if (!rec || typeof rec.id !== 'string' || typeof rec.updatedAt !== 'number') continue;
      pushed++;
      statements.push(
        env.DB.prepare(
          `INSERT INTO records (kind, id, updated_at, json) VALUES (?, ?, ?, ?)
           ON CONFLICT (kind, id) DO UPDATE SET updated_at = excluded.updated_at, json = excluded.json
           WHERE excluded.updated_at > records.updated_at`,
        ).bind(kind, rec.id, rec.updatedAt, JSON.stringify(rec)),
      );
    }
  }
  if (statements.length > 0) await env.DB.batch(statements);

  // Hand back the merged truth.
  const rows = await env.DB.prepare('SELECT kind, json FROM records').all<{
    kind: Kind;
    json: string;
  }>();
  const data: Record<Kind, unknown[]> = {
    exercises: [],
    templates: [],
    sessions: [],
    feedback: [],
  };
  for (const row of rows.results) {
    if (!KINDS.includes(row.kind)) continue;
    try {
      data[row.kind].push(JSON.parse(row.json));
    } catch {
      // A corrupt row must not sink the whole sync.
    }
  }

  return json({ ok: true, pushed, data }, 200, origin, env);
}
