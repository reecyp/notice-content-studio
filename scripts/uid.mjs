#!/usr/bin/env node
/**
 * Stamps a uid on any deck that does not have one.
 *
 * A uid is written once and then never touched: it is the deck's identity in
 * the database, so rewriting it would orphan every send already logged against
 * it. This script therefore only ever fills in a blank, and says so per file.
 *
 * `--check` stamps nothing and exits non-zero on a deck without one, which is
 * how `npm run check` catches a deck the site would refuse to load.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const files = readdirSync('decks').filter((f) => f.endsWith('.json')).sort();
const checkOnly = process.argv.includes('--check');

let stamped = 0;
for (const file of files) {
  const path = `decks/${file}`;
  const text = readFileSync(path, 'utf8');
  const deck = JSON.parse(text);

  if (typeof deck.uid === 'string' && UUID.test(deck.uid)) {
    if (!checkOnly) console.log(`  ${file}  ${deck.uid}`);
    continue;
  }

  if (checkOnly) {
    console.error(`  ${file}  has no uid. Run \`npm run uid\`.`);
    process.exitCode = 1;
    continue;
  }

  // Rewritten by hand rather than through JSON.stringify so the file keeps its
  // own formatting, and uid lands directly under id where it reads as identity.
  const uid = randomUUID();
  const withUid = text.replace(/^(\s*)"id":\s*("[^"]*"),?$/m, (line, indent, id) =>
    `${indent}"id": ${id},\n${indent}"uid": "${uid}",`,
  );
  if (withUid === text) {
    console.error(`  ${file}  could not find an "id" line to stamp under`);
    process.exitCode = 1;
    continue;
  }
  writeFileSync(path, withUid);
  stamped++;
  console.log(`  ${file}  ${uid}  (new)`);
}

if (checkOnly) {
  if (!process.exitCode) console.log(`uid: ${files.length} decks, all stamped.`);
} else {
  console.log(`\n${files.length} deck${files.length === 1 ? '' : 's'}, ${stamped} stamped.`);
}
