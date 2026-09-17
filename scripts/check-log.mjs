/**
 * Headless verification of what /log reads.
 *
 * check-ledger proves the ledger and check-queue proves the batch rules. This
 * proves the third reading of the same tables: the three tabs, and the promise
 * each one makes about what it is showing.
 *
 * The invariant worth the file: a failed send clears sent_at, so a failure is
 * also an unsent deck. Queue and Failed therefore have to carve that deck out
 * of exactly one of them, and the count that keeps it findable has to agree.
 *
 * Same rig as check-ledger: real Postgres (PGlite, in process) behind a stand-in
 * for Neon's HTTP endpoint, so the SQL runs rather than a mock of it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register(new URL('./ts-resolve.mjs', import.meta.url));

const { serveNeon, SHIM_URL } = await import('./pg-shim.mjs');

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  console.log('  skip log checks: @electric-sql/pglite is not installed\n');
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

serveNeon(pg);
process.env.DATABASE_URL = SHIM_URL;

for (const stmt of readFileSync('scripts/schema.sql', 'utf8').split(/;\s*$/m)) {
  if (stmt.trim()) await pg.exec(stmt);
}

const db = await import('../lib/db.ts');

const deck = (n, createdAt, tiles = 6) => ({
  schemaVersion: 2,
  id: `deck-${n}`,
  uid: `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`,
  createdAt,
  iteration: 1,
  format: 'paper-note',
  tiles: Array(tiles).fill({ role: 'hook', lines: ['x'] }),
});

// Out of made-order on purpose, so nothing can pass by accident of insertion.
const A = deck(1, '2026-03-02');
const B = deck(2, '2026-01-10');
const C = deck(3, '2026-02-14');
const D = deck(4, '2026-04-20');
await db.syncVideos([A, B, C, D]);

console.log('the queue tab');
let q = await db.queuePage();
check('it lists every deck that has never been handed over', q.rows.length === 4, `${q.rows.length}`);
check('total agrees with the rows when nothing is cut off', q.total === 4, `${q.total}`);
check(
  'it is oldest made first, the order the batch will send in',
  q.rows.map((r) => r.deckId).join(',') === 'deck-2,deck-3,deck-1,deck-4',
  q.rows.map((r) => r.deckId).join(','),
);
check(
  'the order is the one nextUnsent uses',
  q.rows.map((r) => r.deckId).join(',') === (await db.nextUnsent(10)).map((r) => r.deckId).join(','),
);
check('it carries what the row needs to render', q.rows[0].tileCount === 6 && q.rows[0].madeAt !== null);

const capped = await db.queuePage({}, 2);
check('a limit cuts the rows', capped.rows.length === 2);
check('but total still counts the whole match', capped.total === 4, `${capped.total}`);

console.log('\nthe queue tab, filtered by the day a deck was made');
check('a from-date drops everything earlier', (await db.queuePage({ from: '2026-02-14' })).total === 3);
check('a to-date drops everything later', (await db.queuePage({ to: '2026-02-14' })).total === 2);
// A deck made on the to-date is in the range. Off by a day here would hide a
// whole day's work from whoever set the filter.
check(
  'both ends are inclusive of their own day',
  (await db.queuePage({ from: '2026-01-10', to: '2026-01-10' })).total === 1,
);
check('a range with nothing in it comes back empty, not unfiltered',
  (await db.queuePage({ from: '2025-01-01', to: '2025-12-31' })).total === 0);

console.log('\na send leaves the queue tab for the sent tab');
await db.recordSend(B, { publishId: 'pub-b-1', caption: 'a caption' });
await db.settleSend('pub-b-1', 'SEND_TO_USER_INBOX');
q = await db.queuePage();
check('the sent deck is gone from the queue', !q.rows.some((r) => r.deckId === 'deck-2'));
let sent = await db.attemptsPage('sent');
check('and is the only thing in the sent tab', sent.total === 1 && sent.rows[0].deckId === 'deck-2');
check('the sent row carries its status', sent.rows[0].status === 'SEND_TO_USER_INBOX');
check('and the moment it settled', sent.rows[0].settledAt !== null);
check('and what actually went out, snapshotted', sent.rows[0].tileCount === 6 && sent.rows[0].iteration === 1);

console.log('\na failure is pulled out of both other tabs');
await db.recordSend(C, { publishId: 'pub-c-1' });
await db.settleSend('pub-c-1', 'FAILED', 'photo pull failed');
// The ledger has put deck-3 back in the queue. The log must not show it there
// as though it had never been tried.
check('the ledger has it back in the queue', (await db.nextUnsent(10)).some((r) => r.deckId === 'deck-3'));
q = await db.queuePage();
check('the queue tab does not show it', !q.rows.some((r) => r.deckId === 'deck-3'), q.rows.map(r=>r.deckId).join(','));
check('retryPending counts it, so the queue tab can say where it went', (await db.retryPending()) === 1);
const failed = await db.attemptsPage('failed');
check('the failed tab has it', failed.total === 1 && failed.rows[0].deckId === 'deck-3');
check('with the reason', failed.rows[0].error === 'photo pull failed');
check('the sent tab does not', !(await db.attemptsPage('sent')).rows.some((r) => r.deckId === 'deck-3'));

console.log('\nan attempt that never got a publish id');
await db.recordFailedSend(D, { error: 'token expired', logId: 'log-9' });
check('lands in the failed tab', (await db.attemptsPage('failed')).total === 2);
check(
  'with no publish id to show',
  (await db.attemptsPage('failed')).rows[0].publishId === null,
);
check('and still counts as awaiting retry', (await db.retryPending()) === 2);

console.log('\none row per attempt, not per deck');
await db.recordSend(C, { publishId: 'pub-c-2' });
await db.settleSend('pub-c-2', 'PUBLISH_COMPLETE');
const both = await db.attemptsPage('sent');
check('the deck that failed then succeeded shows its success', both.rows.some((r) => r.deckId === 'deck-3'));
check('its failure is still in the failed tab', (await db.attemptsPage('failed')).rows.some((r) => r.deckId === 'deck-3'));
await db.recordSend(C, { publishId: 'pub-c-3' });
const again = await db.attemptsPage('sent');
check(
  'a second send of the same deck is a second row',
  again.rows.filter((r) => r.deckId === 'deck-3').length === 2,
  `${again.rows.filter((r) => r.deckId === 'deck-3').length}`,
);
check('newest first', new Date(again.rows[0].createdAt) >= new Date(again.rows[1].createdAt));

console.log('\nthe sent and failed tabs filter on the day of the send');
// Backdate the attempts, which is the one thing now() will not do for us.
await pg.query(`update send set created_at = '2026-05-01 09:00+00' where publish_id = 'pub-b-1'`);
await pg.query(`update send set created_at = '2026-05-03 09:00+00' where publish_id = 'pub-c-2'`);
await pg.query(`update send set created_at = '2026-05-03 11:00+00' where publish_id = 'pub-c-1'`);
await pg.query(`update send set created_at = '2026-04-02 09:00+00' where log_id = 'log-9'`);
check('a send on the from-date is kept', (await db.attemptsPage('sent', { from: '2026-05-03' })).total >= 1);
check('a send before it is dropped', !(await db.attemptsPage('sent', { from: '2026-05-03' })).rows.some((r) => r.publishId === 'pub-b-1'));
check(
  'a single-day range keeps that whole day',
  (await db.attemptsPage('sent', { from: '2026-05-01', to: '2026-05-01' })).total === 1,
);
check(
  'the failed tab filters on the same date',
  (await db.attemptsPage('failed', { from: '2026-05-03', to: '2026-05-03' })).total === 1,
);
check(
  'and finds nothing outside it',
  (await db.attemptsPage('failed', { from: '2026-06-01' })).total === 0,
);

console.log('\nwithout a database');
const env = { ...process.env };
delete env.DATABASE_URL;
const out = execFileSync(
  process.execPath,
  [
    '--import', new URL('./register-ts.mjs', import.meta.url).href,
    '--input-type=module', '-e',
    "const db = await import('./lib/db.ts');" +
    "const q = await db.queuePage(); const s = await db.attemptsPage('sent');" +
    "console.log(q.rows.length, q.total, s.rows.length, s.total, await db.retryPending());",
  ],
  { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
)
  // The child inspects its own numbers, and colours them when the environment
  // says to. Compare the values, not the escape codes.
  .replace(/\u001b\[[0-9;]*m/g, '')
  .trim();
// The page renders a "no ledger" notice off hasDb(); these must not throw on
// the way there.
check('every log query is a no-op with no DATABASE_URL', out === '0 0 0 0 0', out);

check('no database error was swallowed', warnings.length === 0, warnings.join(' | '));

console.log(failures === 0 ? '\nAll log checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
