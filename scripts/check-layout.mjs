/**
 * Headless verification of the layout grammar.
 *
 * Compiles lib/ with tsc, then exercises layoutTile against a stubbed text
 * measurer. This checks the geometry rules (anchor, gaps, hug, fit pass)
 * without rendering or opening a single PNG.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(path.join(tmpdir(), 'ncs-check-'));
execFileSync(
  'npx',
  ['tsc', 'lib/render.ts', 'lib/types.ts', '--outDir', out,
   '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck'],
  { stdio: 'inherit' },
);

const R = await import(pathToFileURL(path.join(out, 'render.js')).href);

// Times New Roman averages a shade under half an em per character.
const measure = (text, size) => text.length * size * 0.46;

const BODY_ADV = R.TYPE.body.size * R.TYPE.body.lh;      // 55.44
const TITLE_ADV = R.TYPE.title.size * R.TYPE.title.lh;   // 50.4
const BULLET_ADV = R.TYPE.bullet.size * R.TYPE.bullet.lh; // 75.6

const TITLE_BLANK = BODY_ADV * R.SPACING.title;
const TITLE_HUG_BLANK = BODY_ADV * R.SPACING.titleHug;
const BLOCK_BLANK = BODY_ADV * R.SPACING.block;

let failures = 0;
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const para = (text, hug) => ({ kind: 'paragraph', text, ...(hug ? { hug: true } : {}) });

console.log('\nblock gaps');
{
  const tile = { role: 'point', points: [{ number: 1, title: 'T', body: [para('A'), para('B')] }] };
  const { lines } = R.layoutTile(tile, measure);
  const titleGap = lines[1].baseline - lines[0].baseline;
  const blockGap = lines[2].baseline - lines[1].baseline;
  check('title -> body uses the title blank',
    near(titleGap, TITLE_ADV + TITLE_BLANK), `${titleGap.toFixed(2)}`);
  check('paragraph -> paragraph uses the block blank',
    near(blockGap, BODY_ADV + BLOCK_BLANK), `${blockGap.toFixed(2)}`);
  check('a title is given more air than two paragraphs get', titleGap > blockGap,
    `title ${titleGap.toFixed(1)} vs block ${blockGap.toFixed(1)}`);
  console.log(`       title gap ${titleGap.toFixed(1)}px, block gap ${blockGap.toFixed(1)}px`);
}

console.log('\nhug');
{
  const tile = { role: 'point', points: [{ number: 1, title: 'T', body: [para('A', true), para('B')] }] };
  const { lines } = R.layoutTile(tile, measure);
  const gap = lines[1].baseline - lines[0].baseline;
  check('a hugged body still gets the title margin',
    near(gap, TITLE_ADV + TITLE_HUG_BLANK), `${gap.toFixed(2)}`);
  check('the title margin is real, not zero', gap > TITLE_ADV + 1);
  console.log(`       hugged title gap ${gap.toFixed(1)}px (bare advance is ${TITLE_ADV.toFixed(1)})`);
}

{
  const tile = { role: 'point', points: [{ title: 'T', body: [para('A'), para('B', true)] }] };
  const { lines } = R.layoutTile(tile, measure);
  check('hug between two body blocks is still flush',
    near(lines[2].baseline - lines[1].baseline, BODY_ADV));
}

console.log('\ntitleSub');
{
  const tile = { role: 'point', points: [{ number: 2, title: 'Health', titleSub: '(foundation)', body: [para('A')] }] };
  const { lines } = R.layoutTile(tile, measure);
  check('titleSub sits flush under its title, with no margin',
    near(lines[1].baseline - lines[0].baseline, TITLE_ADV));
  check('body after titleSub takes the title blank',
    near(lines[2].baseline - lines[1].baseline, TITLE_ADV + TITLE_BLANK));
}

console.log('\ntight lines vs spaced paragraphs');
{
  const tight = { role: 'point', points: [{ title: 'T', body: [{ kind: 'lines', lines: ['a', 'b', 'c'] }] }] };
  const t = R.layoutTile(tight, measure).lines;
  check('lines stanza packs at one body advance',
    near(t[2].baseline - t[1].baseline, BODY_ADV) && near(t[3].baseline - t[2].baseline, BODY_ADV));

  const spaced = { role: 'point', points: [{ title: 'T', body: [para('a'), para('b'), para('c')] }] };
  const s = R.layoutTile(spaced, measure).lines;
  check('spaced paragraphs sit further apart than a stanza',
    near(s[2].baseline - s[1].baseline, BODY_ADV + BLOCK_BLANK) &&
      s[2].baseline - s[1].baseline > BODY_ADV);
}

console.log('\nbullets');
{
  const tile = { role: 'point', points: [{ title: 'T', body: [
    { kind: 'lead', text: 'Three:', hug: true },
    { kind: 'bullets', items: ['one', 'two', 'three'] },
    para('closing'),
  ] }] };
  const { lines } = R.layoutTile(tile, measure);
  const bullets = lines.filter((l) => l.marker);
  check('every bullet item gets a disc', bullets.length === 3);
  check('discs sit at the marker inset', bullets.every((b) => near(b.marker.x, R.BULLET_MARKER_X)));
  check('bullet text sits at the text inset', bullets.every((b) => near(b.x, R.BULLET_TEXT_X)));
  check('bullet -> bullet = one bullet advance',
    near(bullets[1].baseline - bullets[0].baseline, BULLET_ADV),
    `${(bullets[1].baseline - bullets[0].baseline).toFixed(2)} vs ${BULLET_ADV.toFixed(2)}`);
  const closing = lines[lines.length - 1];
  check('last bullet -> closing = bullet advance + block blank',
    near(closing.baseline - bullets[2].baseline, BULLET_ADV + BLOCK_BLANK),
    `${(closing.baseline - bullets[2].baseline).toFixed(2)}`);
}

console.log('\nanchoring');
{
  const short = { role: 'point', points: [{ title: 'T', body: [para('short')] }] };
  const long = { role: 'point', points: [{ title: 'T', body: [para('x'), para('y'), para('z'), para('w')] }] };
  for (const [name, tile] of [['short', short], ['long', long]]) {
    const { lines } = R.layoutTile(tile, measure);
    const last = lines[lines.length - 1];
    const bottomEdge = last.baseline + 0.216 * last.size;
    check(`${name} tile bottom edge lands on 904`, near(bottomEdge, R.BAND_BOTTOM, 0.6),
      `${bottomEdge.toFixed(2)}`);
  }
}

console.log('\nhook');
{
  const { lines } = R.layoutTile({ role: 'hook', lines: ['How to become', '**mess with:**'] }, measure);
  check('hook line 1 sits at its fixed baseline', near(lines[0].baseline, R.HOOK_BASELINE_1));
  check('hook line 2 follows at the hook advance',
    near(lines[1].baseline - lines[0].baseline, R.TYPE.hook.size * R.TYPE.hook.lh));
  check('hook bold span parsed', lines[1].runs.some((r) => r.bold && r.text.includes('mess')));
}

console.log('\nfit pass');
{
  const filler = Array.from({ length: 14 }, (_, i) => para(`Line number ${i} of a body that will not fit.`));
  const tile = { role: 'point', points: [{ number: 1, title: 'Huge', body: filler }] };
  const l = R.layoutTile(tile, measure);
  check('over-long tile is flagged', l.overLong === true);
  check('scale bottoms out at the floor', near(l.scale, R.FIT_FLOOR, 0.001), `scale ${l.scale}`);

  const ok = { role: 'point', points: [{ number: 1, title: 'Fine', body: [para('short')] }] };
  const okL = R.layoutTile(ok, measure);
  check('a tile that fits stays at 100%', near(okL.scale, 1, 0.001) && okL.overLong === false);
}

console.log('\nspacing is not adjustable');
{
  check('layoutTile takes no spacing argument', R.layoutTile.length === 2,
    `arity ${R.layoutTile.length}`);
  check('paintTile takes no spacing argument', R.paintTile.length === 3,
    `arity ${R.paintTile.length}`);
}

console.log('\nspacing is independent of block kind');
{
  const mk = (second) => ({ role: 'point', points: [{ title: 'T', body: [
    { kind: 'lines', lines: ['a', 'b'] },
    second,
  ] }] });
  const toPara = R.layoutTile(mk(para('x')), measure).lines;
  const toBullets = R.layoutTile(mk({ kind: 'bullets', items: ['x'] }), measure).lines;
  const gapA = toPara[3].baseline - toPara[2].baseline;
  const gapB = toBullets[3].baseline - toBullets[2].baseline;
  check('lines -> paragraph and lines -> bullets get the same gap', near(gapA, gapB),
    `${gapA.toFixed(2)} vs ${gapB.toFixed(2)}`);
}

console.log('\nreal decks');
for (const file of readdirSync('decks').filter((f) => f.endsWith('.json')).sort()) {
  const deck = JSON.parse(readFileSync(`decks/${file}`, 'utf8'));
  const results = deck.tiles.map((t) => R.layoutTile(t, measure));
  const over = results.map((r, i) => (r.overLong ? i + 1 : 0)).filter(Boolean);
  const shrunk = results.map((r, i) => (r.scale < 0.999 ? `${i + 1}@${(r.scale * 100).toFixed(0)}%` : '')).filter(Boolean);
  check(`${deck.id}: no tile over-long`, over.length === 0, `tiles ${over.join(', ')}`);
  console.log(`       ${deck.tiles.length} tiles, shrunk: ${shrunk.length ? shrunk.join(' ') : 'none'}`);
}

rmSync(out, { recursive: true, force: true });
console.log(failures === 0 ? '\nAll layout checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
