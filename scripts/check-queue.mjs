/**
 * Headless verification of the batch endpoint.
 *
 * check-ledger proves the SQL under "send the next 10". This proves the rules
 * on top of it, which is where the ask actually lives: all or nothing, oldest
 * made first, stop on the first failure, and never keep a refresh token TikTok
 * has already rotated away.
 *
 * Both of the endpoint's dependencies are stood in for rather than mocked. The
 * database is a real Postgres (PGlite, in process) behind the same Neon-over-
 * HTTP shim check-ledger uses. TikTok is a fake on the same fetch hook, which
 * can be told to fail on the nth call. What runs in between is the route.
 */
import { register } from 'node:module';

register(new URL('./ts-resolve.mjs', import.meta.url));

const { serveNeon, SHIM_URL } = await import('./pg-shim.mjs');

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  console.log('  skip queue checks: @electric-sql/pglite is not installed\n');
  process.exit(0);
}

const warnings = [];
console.warn = (...a) => warnings.push(a.join(' '));

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  (${detail})` : ''}`);
  }
}

// --- TikTok, as much of it as the route calls ------------------------------

const tiktok = { init: 0, failOn: 0, rotate: false, refreshes: 0 };

async function fakeTikTok(url, init) {
  const href = String(url);
  const ok = (data) =>
    new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

  if (href.includes('/oauth/token/')) {
    tiktok.refreshes++;
    return ok({
      open_id: 'open-1',
      access_token: 'access-rotated',
      refresh_token: 'refresh-rotated',
      expires_in: 86400,
    });
  }
  if (href.includes('/content/init/')) {
    tiktok.init++;
    if (tiktok.failOn === tiktok.init) {
      return ok({ error: { code: 'rate_limit_exceeded', message: 'too many requests', log_id: 'log-x' } });
    }
    return ok({ data: { publish_id: `pub-${tiktok.init}` }, error: { code: 'ok' } });
  }
  throw new Error(`unexpected fetch to ${href}`);
}

// --- Wiring ----------------------------------------------------------------

const pg = await PGlite.create();
serveNeon(pg, fakeTikTok);

const { readFileSync } = await import('node:fs');
for (const stmt of readFileSync('scripts/schema.sql', 'utf8').split(/;\s*$/m)) {
  if (stmt.trim()) await pg.exec(stmt);
}

const KEY = 'test-key-not-a-real-one';
process.env.DATABASE_URL = SHIM_URL;
process.env.QUEUE_API_KEY = KEY;
process.env.TIKTOK_CLIENT_KEY = 'ck';
process.env.TIKTOK_CLIENT_SECRET = 'cs';
process.env.TIKTOK_PUBLIC_BASE = 'https://studio.example.com';
// The pacing is the one thing not under test: 6 requests a minute is TikTok's
// number, not a behaviour of this code, and honouring it here would buy a
// minute of sleep per run.
process.env.QUEUE_SPACING_MS = '0';

const { seal } = await import('../lib/tiktok.ts');
const db = await import('../lib/db.ts');
const route = await import('../app/api/queue/send/route.ts');

const ORIGIN = 'https://studio.example.com/api/queue/send';
const send = (body, key = KEY) =>
  route.POST(
    new Request(ORIGIN, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const status = (key = KEY) =>
  route.GET(new Request(ORIGIN, { headers: { authorization: `Bearer ${key}` } }));

const json = async (res) => [res.status, await res.json()];

/** A session good for another day, as the callback would have stored it. */
const connect = (expiresInMs = 86_400_000) =>
  db.saveSession(
    seal(
      { openId: 'open-1', accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + expiresInMs },
      'cs',
    ),
    'open-1',
  );

// The decks on disk are the fixture: the route reads them, so the queue is
// however many real deck files the repo has.
const { loadAllDecks } = await import('../lib/decks.ts');
const DECKS = (await loadAllDecks()).flatMap((d) => ('deck' in d ? [d.deck] : []));
const ordered = [...DECKS].sort(
  (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
);

console.log('the door');
check('a wrong key is turned away', (await send({ count: 1 }, 'wrong')).status === 401);
check('no key at all is turned away',
  (await route.POST(new Request(ORIGIN, { method: 'POST', body: '{}' }))).status === 401);

{
  const [code, body] = await json(await send({ count: 1 }));
  check('an unconnected account cannot post', code === 409 && Boolean(body.connect), `${code}`);
  check('nothing was sent to TikTok', tiktok.init === 0);
}

await connect();

console.log('\nthe batch is all or nothing');
{
  const [code, body] = await json(await send({ count: DECKS.length + 5 }));
  check('a short queue sends nothing', code === 409 && body.available === DECKS.length, JSON.stringify(body));
  check('a refused batch called TikTok zero times', tiktok.init === 0);
}
{
  const [code] = await json(await send({ count: 0 }));
  check('count must be at least 1', code === 400);
}
{
  const [code, body] = await json(await send({ count: 99 }));
  // Rejected rather than truncated to 20: a batch that silently shrinks is a
  // batch that lies about what it did.
  check('a batch bigger than the cap is refused', code === 400 && body.maxBatch === 20);
}

console.log('\na full batch');
{
  const [code, body] = await json(await send({ count: DECKS.length }));
  check('every deck goes out', code === 200 && body.sent === DECKS.length, JSON.stringify(body));
  const got = body.decks.map((d) => d.deckId).join(',');
  const want = ordered.map((d) => d.id).join(',');
  check('in oldest-made-first order', got === want, `${got} vs ${want}`);
  check('one TikTok call per deck', tiktok.init === DECKS.length, String(tiktok.init));
  check('the queue is now empty', (await db.unsentCount()) === 0);
}
{
  const [code, body] = await json(await send({ count: 1 }));
  check('a drained queue refuses the next batch', code === 409 && body.available === 0);
}

console.log('\na failure stops the batch');
await pg.exec('delete from send');
await pg.exec('update video set sent_at = null');
tiktok.init = 0;
tiktok.failOn = 2;
{
  const [code, body] = await json(await send({ count: DECKS.length }));
  check('the batch reports the failure', code === 502, `${code}`);
  check('it names the deck it stopped on', body.failedOn === ordered[1].id, body.failedOn);
  check('it reports what did get out', body.sent === 1, JSON.stringify(body.sent));
  check('it did not try the rest', tiktok.init === 2, String(tiktok.init));
  check('the deck that went out has left the queue', (await db.unsentCount()) === DECKS.length - 1);
  // A retry has to resume, not restart: the first deck is genuinely posted.
  const next = (await db.nextUnsent(10)).map((q) => q.deckId);
  check('a retry resumes where it stopped', next[0] === ordered[1].id, next.join(','));
}

console.log('\na rotated refresh token');
await pg.exec('delete from send');
await pg.exec('update video set sent_at = null');
tiktok.init = 0;
tiktok.failOn = 0;
// An already-expired session forces freshen() to refresh on the first deck.
await connect(-1000);
{
  const [code] = await json(await send({ count: DECKS.length }));
  check('an expired session refreshes rather than failing', code === 200, String(code));
  check('it refreshed once, not once per deck', tiktok.refreshes === 1, String(tiktok.refreshes));
  // TikTok spends the old refresh token when it hands back a new one, so a
  // stored session that was not rewritten is the next run's failure.
  const stored = await db.loadSession();
  const { unseal } = await import('../lib/tiktok.ts');
  check('the rotated token was written back',
    unseal(stored?.sealed, 'cs')?.refreshToken === 'refresh-rotated');
}

console.log('\nthe status verb');
{
  const [code, body] = await json(await status());
  check('GET reports the connection', code === 200 && body.connected === true);
  check('GET reports an empty queue', body.queued === 0 && body.ready === 0, JSON.stringify(body));
  check('GET names its own batch cap', body.maxBatch === 20);
  check('GET is turned away without the key', (await status('wrong')).status === 401);
}

check('no database error was swallowed', warnings.length === 0, warnings.join(' | '));

console.log(failures === 0 ? '\nAll queue checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
