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
import { register } from 'node:module';

// lib/ is written for the bundler's resolution, so ./send-state needs a hand.
register(new URL('./ts-resolve.mjs', import.meta.url));

const { serveNeon, SHIM_URL } = await import('./pg-shim.mjs');

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

serveNeon(pg);
process.env.DATABASE_URL = SHIM_URL;

console.log('schema');
for (const stmt of readFileSync('scripts/schema.sql', 'utf8').split(/;\s*$/m)) {
  if (stmt.trim()) await pg.exec(stmt);
}
check('scripts/schema.sql applies', true);

const db = await import('../lib/db.ts');

const deck = (id, uid, tiles, createdAt) => ({
  schemaVersion: 2, id, uid, createdAt, iteration: 1, format: 'paper-note',
  tiles: Array(tiles).fill({ role: 'hook', lines: ['x'] }),
  post: { description: 'a caption', hashtags: ['stoicism'] },
});
// Deliberately out of alphabetical and out of insert order: the queue sorts by
// the date in the deck file, and nothing else is allowed to decide it.
const A = deck('deck-a', '11111111-1111-4111-8111-111111111111', 6, '2026-03-02');
const B = deck('deck-b', '22222222-2222-4222-8222-222222222222', 9, '2026-01-10');
const C = deck('deck-c', '33333333-3333-4333-8333-333333333333', 5, '2026-02-14');

console.log('\nthe registry');
await db.syncVideos([A, B, C]);
await db.syncVideos([A, B, C]);
const rows = (await pg.query('select count(*)::int n from video')).rows[0].n;
check('syncVideos mirrors disk and is idempotent', rows === 3, `${rows} rows`);
check('nextUnsent starts as everything', (await db.nextUnsent(10)).length === 3);
check('unsentCount agrees with the queue', (await db.unsentCount()) === 3);

// B was made first and inserted second. If the queue ever reads created_at
// again this is the check that catches it.
const order = (await db.nextUnsent(10)).map((q) => q.deckId).join(',');
check('the queue is oldest made first, not insert order', order === 'deck-b,deck-c,deck-a', order);

// Two decks made the same day still have to come out in a fixed order, or the
// same batch call sends a different pair each time it runs.
const D = deck('deck-d', '44444444-4444-4444-8444-444444444444', 4, '2026-01-10');
await db.syncVideos([D]);
const tied = (await db.nextUnsent(10)).map((q) => q.deckId).join(',');
check('a same-day tie breaks on deck_id', tied === 'deck-b,deck-d,deck-c,deck-a', tied);
await pg.query('delete from video where deck_id = $1', ['deck-d']);

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
// A MEDIA_UPLOAD post comes to rest in the creator's inbox, not at
// PUBLISH_COMPLETE, so that is the status a normal successful send settles on.
await db.settleSend('pub-a-1', 'PROCESSING_DOWNLOAD');
check('a pull in progress does not settle the row',
  (await pg.query(`select settled_at from send where publish_id = 'pub-a-1'`)).rows[0].settled_at === null);

await db.settleSend('pub-a-1', 'SEND_TO_USER_INBOX');
states = await db.sendStates();
check('delivery to the inbox is written back', states.get(A.uid)?.lastStatus === 'SEND_TO_USER_INBOX');
check('delivery to the inbox settles the row',
  (await pg.query(`select settled_at from send where publish_id = 'pub-a-1'`)).rows[0].settled_at !== null);
check('a video in the inbox counts as sent', Boolean(states.get(A.uid)?.sentAt));
check('a video in the inbox stays out of the queue',
  !(await db.nextUnsent(10)).some((q) => q.uid === A.uid));

// The creator taps the notification days later and actually posts it.
await db.settleSend('pub-a-1', 'PUBLISH_COMPLETE');
states = await db.sendStates();
check('a later PUBLISH_COMPLETE still overwrites the status',
  states.get(A.uid)?.lastStatus === 'PUBLISH_COMPLETE');

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

console.log('\nthe stored account');
// The blob is opaque here on purpose: sealing belongs to lib/tiktok.ts and the
// key is the client secret, so this table never sees a token.
check('no account is stored to begin with', (await db.loadSession()) === null);
check('saving an account reports that it landed', (await db.saveSession('sealed-v1', 'open-1')) === true);
let stored = await db.loadSession();
check('the stored account reads back', stored?.sealed === 'sealed-v1' && stored?.openId === 'open-1');
await db.saveSession('sealed-v2', 'open-1');
stored = await db.loadSession();
check('a rotated token overwrites rather than duplicating', stored?.sealed === 'sealed-v2');
check('only ever one account row',
  (await pg.query('select count(*)::int n from tiktok_session')).rows[0].n === 1);
await db.clearSession();
check('clearing forgets the account', (await db.loadSession()) === null);

console.log('\nwithout a database');
const env = { ...process.env };
delete env.DATABASE_URL;
const out = execFileSync(process.execPath, [
  '--import', new URL('./register-ts.mjs', import.meta.url).href,
  '--input-type=module', '-e',
  "const db = await import('./lib/db.ts');" +
  "const d = {uid:'x',id:'y',createdAt:'2026-01-01',iteration:1,tiles:[]};" +
  "await db.syncVideos([d]);" +
  "await db.recordSend(d,{publishId:'p'});" +
  "await db.saveSession('sealed');" +
  "console.log(db.hasDb(), (await db.nextUnsent(5)).length, (await db.sendStates()).size," +
  "  await db.unsentCount(), await db.loadSession());",
], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
// The batch endpoint reads loadSession to decide whether it may post at all, so
// no database has to read as "not connected" rather than as anything else.
check('every call is a no-op with no DATABASE_URL', out === 'false 0 0 0 null', out);

check('no database error was swallowed', warnings.length === 0, warnings.join(' | '));

console.log(failures === 0 ? '\nAll ledger checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
