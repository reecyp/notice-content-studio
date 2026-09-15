/**
 * The tile face, asserted.
 *
 * Every wrap point and every fit scale in lib/render.ts is a function of
 * measureText, so the layout is only stable while the font is. This checks the
 * committed faces load and measure exactly as designed, and — on a machine
 * that has Times New Roman — that the substitution is genuinely metric-free of
 * drift rather than merely close.
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const FAMILY = 'Notice Serif';
const FACES = ['LiberationSerif-Regular.ttf', 'LiberationSerif-Bold.ttf'];

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('\nfaces');
for (const face of FACES) {
  const p = path.join('public/fonts', face);
  check(`${face} registers`, GlobalFonts.registerFromPath(p, FAMILY));
}
check(`"${FAMILY}" is resolvable`, GlobalFonts.has(FAMILY));

const ctx = createCanvas(10, 10).getContext('2d');
const width = (text, size, bold, family = FAMILY) => {
  ctx.font = `${bold ? 'bold ' : ''}${size}px "${family}"`;
  return ctx.measureText(text).width;
};

console.log('\nadvance widths are pinned');
{
  // Measured off the committed TTFs. A changed face moves these, and a moved
  // number means every tile rewraps.
  const golden = [
    ['The quick brown fox jumps over the lazy dog', 42, false, 767.47998046875],
    ['The quick brown fox jumps over the lazy dog', 42, true, 810.530029296875],
    ['How to become', 50, false, 316.5799865722656],
    ['@noticeapp', 34, false, 163.47999572753906],
    ['0123456789', 42, false, 210],
  ];
  for (const [text, size, bold, expected] of golden) {
    const got = width(text, size, bold);
    check(
      `${bold ? 'bold ' : ''}${size}px "${text.slice(0, 24)}${text.length > 24 ? '…' : ''}"`,
      Math.abs(got - expected) < 0.0001,
      `${got} vs ${expected}`,
    );
  }
  check('regular and bold are distinct faces', width('Wm', 42, false) !== width('Wm', 42, true));
}

console.log('\nmetric compatibility with Times New Roman');
if (!GlobalFonts.has('Times New Roman')) {
  console.log('  skip  Times New Roman is not installed here (expected off macOS)');
} else {
  // Every string the real decks put on a tile, and every token they wrap by.
  const strings = new Set();
  const walk = (v) => {
    if (typeof v === 'string') strings.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const f of readdirSync('decks').filter((f) => f.endsWith('.json'))) {
    walk(JSON.parse(readFileSync(path.join('decks', f), 'utf8')).tiles);
  }
  for (const s of [...strings]) for (const tok of s.split(/\s+/)) if (tok) strings.add(tok);

  let worst = 0;
  let worstCase = '';
  let n = 0;
  for (const s of strings) {
    for (const [size, bold] of [[50, false], [42, false], [42, true], [34, false]]) {
      const d = Math.abs(width(s, size, bold) - width(s, size, bold, 'Times New Roman'));
      n++;
      if (d > worst) {
        worst = d;
        worstCase = `"${s.slice(0, 32)}" @${size}${bold ? ' bold' : ''}`;
      }
    }
  }
  check(`${n} measurements across ${strings.size} deck strings are identical`, worst === 0,
    `largest delta ${worst.toFixed(4)}px at ${worstCase}`);
}

console.log(failures === 0 ? '\nAll font checks passed.\n' : `\n${failures} font check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
