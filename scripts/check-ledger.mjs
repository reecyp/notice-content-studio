/**
 * Headless verification of the send ledger.
 *
 * Runs lib/db.ts against a real Postgres — PGlite, in this process — by
 * standing in for Neon's HTTP endpoint, so the SQL, the transactions and the
 * row mapping are all exercised without a cloud database or a connection
 * string. Same spirit as check-layout: the invariants that would otherwise
 * only fail in production fail here instead.
 *
 * The invariant that matters most: sent_at is the queue. Anything that moves
 * it, or fails to, changes what "send the next 10" does.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  console.log('  skip ledger checks: @electric-sql/pglite is not installed\n');
  process.exit(0);
}

const pg = await PGlite.create();

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

// --- Neon's HTTP endpoint, served from this process -------------------------

const text = (v) =>
  v === null || v === undefined ? null
  // Postgres text output, not ISO: pg's date parser only matches its own format.
  : v instanceof Date ? v.toISOString().replace('T', ' ').replace('Z', '+00')
  : typeof v === 'object' ? JSON.stringify(v)
  : String(v);

async function run({ query, params }) {
  const r = await pg.query(query, params ?? [], { rowMode: 'array' });
  return {
    fields: (r.fields ?? []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rows: (r.rows ?? []).map((row) => row.map(text)),
    rowCount: r.affectedRows ?? r.rows?.length ?? 0,
    command: query.trim().split(/\s+/)[0].toUpperCase(),
  };
}

globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  let payload;
  if (body.queries) {
    await pg.exec('begin');
    try {
      const results = [];
      for (const q of body.queries) results.push(await run(q));
      await pg.exec('commit');
      payload = { results };
    } catch (e) {
      await pg.exec('rollback');
      throw e;
    }
  } else {
    payload = await run(body);
  }
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

process.env.DATABASE_URL = 'postgresql://check:check@ep-check.us-east-2.aws.neon.tech/check';

console.log('schema');
for (const stmt of readFileSync('scripts/schema.sql', 'utf8').split(/;\s*$/m)) {
  if (stmt.trim()) await pg.exec(stmt);
}
check('scripts/schema.sql applies', true);

const db = await import('../lib/db.ts');

const deck = (id, uid, tiles) => ({
  schemaVersion: 2, id, uid, iteration: 1, format: 'paper-note',
  tiles: Array(tiles).fill({ role: 'hook', lines: ['x'] }),
  post: { description: 'a caption', hashtags: ['stoicism'] },
});
const A = deck('deck-a', '11111111-1111-4111-8111-111111111111', 6);
const B = deck('deck-b', '22222222-2222-4222-8222-222222222222', 9);
const C = deck('deck-c', '33333333-3333-4333-8333-333333333333', 5);

console.log('\nthe registry');
await db.syncVideos([A, B, C]);
await db.syncVideos([A, B, C]);
const rows = (await pg.query('select count(*)::int n from video')).rows[0].n;
check('syncVideos mirrors disk and is idempotent', rows === 3, `${rows} rows`);
check('nextUnsent starts as everything', (await db.nextUnsent(10)).length === 3);

console.log('\na send');
await db.recordSend(A, { publishId: 'pub-a-1', caption: 'a caption' });
let states = await db.sendStates();
check('recordSend sets sent_at', Boolean(states.get(A.uid)?.sentAt));
check('recordSend logs the publish id', states.get(A.uid)?.lastPublishId === 'pub-a-1');
check('a fresh send reads as PROCESSING', states.get(A.uid)?.lastStatus === 'PROCESSING');
check('an untouched deck stays unsent', states.get(B.uid)?.sentAt === null);
const queue = await db.nextUnsent(10);
check('a sent deck leaves the queue', queue.length === 2 && !queue.some((q) => q.uid === A.uid));
check('nextUnsent honours its limit', (await db.nextUnsent(1)).length === 1);

console.log('\nwhat TikTok says afterwards');
await db.settleSend('pub-a-1', 'PUBLISH_COMPLETE');
states = await db.sendStates();
check('a terminal status is written back', states.get(A.uid)?.lastStatus === 'PUBLISH_COMPLETE');
check('a terminal status stamps settled_at',
  (await pg.query(`select settled_at from send where publish_id = 'pub-a-1'`)).rows[0].settled_at !== null);

await db.recordSend(B, { publishId: 'pub-b-1' });
await db.settleSend('pub-b-1', 'FAILED', 'photo pull failed');
states = await db.sendStates();
check('a failed pull clears sent_at', states.get(B.uid)?.sentAt === null);
check('a failed pull returns the video to the queue',
  (await db.nextUnsent(10)).some((q) => q.uid === B.uid));

await db.recordSend(A, { publishId: 'pub-a-2' });
await db.settleSend('pub-a-2', 'FAILED', 'second attempt failed');
states = await db.sendStates();
check('a later failure cannot un-send a video that completed once',
  Boolean(states.get(A.uid)?.sentAt));
check('both sends are in the log', states.get(A.uid)?.sendCount === 2);

const firstSend = (await pg.query('select sent_at from video where uid = $1', [A.uid])).rows[0].sent_at;
const firstLog = (await pg.query('select min(created_at) m from send where video_uid = $1', [A.uid])).rows[0].m;
check('sent_at tracks the first send, not the latest',
  Math.abs(new Date(firstSend) - new Date(firstLog)) < 2000);

console.log('\na call that never got a publish id');
const before = (await db.nextUnsent(10)).length;
await db.recordFailedSend(C, { error: 'token expired', logId: 'log-9' });
check('a failed attempt does not mark the video sent', (await db.nextUnsent(10)).length === before);
states = await db.sendStates();
check('the failed attempt is still logged', states.get(C.uid)?.sendCount === 1);

const log = await db.sendLog(10);
check('sendLog returns every attempt, newest first',
  log.length === 4 && log[0].deckId === C.id, `${log.length} entries`);

console.log('\nwithout a database');
const env = { ...process.env };
delete env.DATABASE_URL;
const out = execFileSync(process.execPath, ['--input-type=module', '-e',
  "const db = await import('./lib/db.ts');" +
  "await db.syncVideos([{uid:'x',id:'y',iteration:1,tiles:[]}]);" +
  "await db.recordSend({uid:'x',id:'y',iteration:1,tiles:[]},{publishId:'p'});" +
  "console.log(db.hasDb(), (await db.nextUnsent(5)).length, (await db.sendStates()).size);",
], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
check('every call is a no-op with no DATABASE_URL', out === 'false 0 0', out);

check('no database error was swallowed', warnings.length === 0, warnings.join(' | '));

console.log(failures === 0 ? '\nAll ledger checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
