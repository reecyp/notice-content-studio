/**
 * The layout grammar. Code owns everything in here; deck JSON never sets it.
 *
 * Numbers derive from docs/deck-schema.md, which in turn was measured off the
 * published tiles in Notice-media/reel-slideshows.
 */

import type { Block, Deck, Point, Tile } from './types';

export const CANVAS = 1080;
export const INSET = 80;
export const TEXT_W = CANVAS - INSET * 2; // 920
export const BAND_TOP = 80;
export const BAND_BOTTOM = 904;
export const BAND_H = BAND_BOTTOM - BAND_TOP; // 824

export const BULLET_MARKER_X = 110;
export const BULLET_TEXT_X = 150;
export const BULLET_TEXT_W = CANVAS - INSET - BULLET_TEXT_X; // 850

export const FIT_FLOOR = 0.8;

/** Hook tiles ignore the bottom anchor and sit at their own fixed baselines. */
export const HOOK_BASELINE_1 = 765;

/**
 * One family name, backed by one committed TTF, registered in both runtimes:
 * the browser via @font-face in globals.css, the server via GlobalFonts in
 * lib/tile-image.ts. Liberation Serif is metric-compatible with Times New
 * Roman, so advance widths — and therefore every wrap point and every fit
 * scale — are identical to what the tiles were designed against.
 *
 * Times New Roman stays in the stack as a fallback with the same metrics, so
 * a failed font load degrades to the right shape rather than to a sans.
 */
export const FONT_FAMILY = 'Notice Serif';
export const FONT_STACK = `"${FONT_FAMILY}", "Liberation Serif", "Times New Roman", Times, serif`;
export const INK = '#111111';

// Times New Roman vertical metrics, as a fraction of em.
const ASCENT = 0.891;
const DESCENT = 0.216;

type Style = { size: number; lh: number; bold: boolean };

export const TYPE = {
  hook: { size: 50, lh: 1.15, bold: false },
  title: { size: 42, lh: 1.2, bold: true },
  body: { size: 42, lh: 1.32, bold: false },
  bullet: { size: 42, lh: 1.8, bold: false },
  endHeadline: { size: 50, lh: 1.2, bold: true },
  endBody: { size: 42, lh: 1.32, bold: false },
  endHandle: { size: 34, lh: 1.3, bold: false },
} satisfies Record<string, Style>;

/**
 * Blank space between blocks, as a multiple of one body line.
 *
 * Two independent knobs, because a title wants air under it while consecutive
 * paragraphs want to read as one column of text. Both are measured at the body
 * rhythm regardless of the blocks either side, so a bullet list and a paragraph
 * are pushed apart by the same amount.
 */
export const SPACING = {
  /** Under a title, when the body below it does not hug. */
  title: 1.4,
  /** Under a title, when the body below it hugs. Tight, but never zero. */
  titleHug: 0.45,
  /** Between two body blocks: paragraph, lead, lines, bullets, in any order. */
  block: 0.75,
};

const BODY_LINE = TYPE.body.size * TYPE.body.lh;

export type Run = { text: string; bold: boolean };
export type Measure = (text: string, size: number, bold: boolean) => number;

export type PlacedLine = {
  runs: Run[];
  x: number;
  baseline: number;
  size: number;
  bold: boolean;
  /** Drawn at its own x on the same baseline, e.g. a bullet disc. */
  marker?: { text: string; x: number };
};

export type TileLayout = {
  lines: PlacedLine[];
  /** Height of the text stack, ascent of the first line to descent of the last. */
  height: number;
  scale: number;
  overLong: boolean;
};

// ---------------------------------------------------------------------------
// Inline emphasis: **bold spans**
// ---------------------------------------------------------------------------

export function parseRuns(text: string): Run[] {
  const out: Run[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out.length ? out : [{ text, bold: false }];
}

const runWidth = (runs: Run[], size: number, baseBold: boolean, m: Measure) =>
  runs.reduce((w, r) => w + m(r.text, size, baseBold || r.bold), 0);

/** Greedy word wrap that carries bold spans across the break. */
function wrap(text: string, width: number, size: number, bold: boolean, m: Measure): Run[][] {
  const tokens: Run[] = [];
  for (const run of parseRuns(text)) {
    const parts = run.text.split(/(\s+)/).filter((s) => s !== '');
    for (const p of parts) tokens.push({ text: p, bold: run.bold });
  }

  const lines: Run[][] = [];
  let current: Run[] = [];
  let w = 0;

  for (const tok of tokens) {
    const tw = m(tok.text, size, bold || tok.bold);
    const isSpace = /^\s+$/.test(tok.text);
    if (current.length && !isSpace && w + tw > width) {
      // Drop a trailing space before breaking.
      while (current.length && /^\s+$/.test(current[current.length - 1].text)) current.pop();
      lines.push(current);
      current = [tok];
      w = tw;
      continue;
    }
    if (!current.length && isSpace) continue;
    current.push(tok);
    w += tw;
  }
  while (current.length && /^\s+$/.test(current[current.length - 1].text)) current.pop();
  if (current.length) lines.push(current);
  return lines.length ? lines : [[{ text: '', bold }]];
}

// ---------------------------------------------------------------------------
// Chunks: a run of lines sharing one style
// ---------------------------------------------------------------------------

type ChunkLine = { runs: Run[]; x: number; marker?: { text: string; x: number } };

type Chunk = {
  lines: ChunkLine[];
  style: Style;
  hug: boolean;
  /** Which blank-space constant precedes this chunk. 'none' is always flush. */
  gap: 'title' | 'block' | 'none';
};

function blockChunk(block: Block, scale: number, lineHeight: number | undefined, m: Measure): Chunk {
  const hug = block.hug === true;

  if (block.kind === 'bullets') {
    const style = { ...TYPE.bullet, lh: lineHeight ?? TYPE.bullet.lh };
    const size = style.size * scale;
    const lines: ChunkLine[] = [];
    for (const item of block.items) {
      const wrapped = wrap(item, BULLET_TEXT_W * scale, size, false, m);
      wrapped.forEach((runs, i) => {
        lines.push({
          runs,
          x: BULLET_TEXT_X * scale,
          // Only the first line of a wrapped item carries the disc.
          ...(i === 0 ? { marker: { text: '\u2022', x: BULLET_MARKER_X * scale } } : {}),
        });
      });
    }
    return { lines, style, hug, gap: 'block' };
  }

  const style = { ...TYPE.body, lh: lineHeight ?? TYPE.body.lh };
  const size = style.size * scale;

  if (block.kind === 'lines') {
    return {
      lines: block.lines.map((text) => ({ runs: parseRuns(text), x: INSET * scale })),
      style,
      hug,
      gap: 'block',
    };
  }

  // paragraph and lead render identically.
  return {
    lines: wrap(block.text, TEXT_W * scale, size, false, m).map((runs) => ({ runs, x: INSET * scale })),
    style,
    hug,
    gap: 'block',
  };
}

function headingChunks(
  title: string | undefined,
  titleSub: string | undefined,
  number: number | undefined,
  scale: number,
  m: Measure,
): Chunk[] {
  if (!title && number === undefined) return [];
  const heading = number !== undefined ? `${number}. ${title ?? ''}`.trim() : (title as string);
  const size = TYPE.title.size * scale;
  const chunks: Chunk[] = [
    {
      lines: wrap(heading, TEXT_W * scale, size, true, m).map((runs) => ({ runs, x: INSET * scale })),
      style: TYPE.title,
      hug: false,
      gap: 'title',
    },
  ];
  if (titleSub) {
    chunks.push({
      lines: wrap(titleSub, TEXT_W * scale, size, true, m).map((runs) => ({ runs, x: INSET * scale })),
      style: TYPE.title,
      hug: true, // a titleSub always sits flush under its title
      gap: 'none',
    });
  }
  return chunks;
}

function pointChunks(p: Point, scale: number, lineHeight: number | undefined, m: Measure): Chunk[] {
  const heading = headingChunks(p.title, p.titleSub, p.number, scale, m);
  const body = p.body.map((b) => blockChunk(b, scale, lineHeight, m));
  if (heading.length && body.length) body[0] = { ...body[0], gap: 'title' };
  return [...heading, ...body];
}

function tileChunks(tile: Tile, scale: number, m: Measure): Chunk[] {
  const lh = tile.layout?.lineHeight;

  if (tile.role === 'point') {
    return tile.points.flatMap((p, i) => {
      const chunks = pointChunks(p, scale, lh, m);
      // A second point on the same tile starts a fresh block gap.
      if (i > 0 && chunks.length) chunks[0] = { ...chunks[0], hug: false, gap: 'title' };
      return chunks;
    });
  }

  if (tile.role === 'closer') {
    const heading = headingChunks(tile.title, tile.titleSub, undefined, scale, m);
    const body = tile.body.map((b) => blockChunk(b, scale, lh, m));
    if (heading.length && body.length) body[0] = { ...body[0], gap: 'title' };
    return [...heading, ...body];
  }

  if (tile.role === 'endcard') {
    const chunks: Chunk[] = [];
    const push = (text: string, style: Style) =>
      chunks.push({
        lines: wrap(text, TEXT_W * scale, style.size * scale, style.bold, m).map((runs) => ({
          runs,
          x: INSET * scale,
        })),
        style,
        hug: false,
        gap: 'block',
      });
    if (tile.headline) push(tile.headline, TYPE.endHeadline);
    if (tile.body) push(tile.body, TYPE.endBody);
    if (tile.handle) push(tile.handle, TYPE.endHandle);
    return chunks;
  }

  // hook
  return tile.lines.map((text) => ({
    lines: wrap(text, TEXT_W * scale, TYPE.hook.size * scale, false, m).map((runs) => ({
      runs,
      x: INSET * scale,
    })),
    style: TYPE.hook,
    hug: true, // hook lines run at their own rhythm, no blank line between
    gap: 'none',
  }));
}

// ---------------------------------------------------------------------------
// Stitching: one blank line between blocks, none when hugging
// ---------------------------------------------------------------------------

function stitch(chunks: Chunk[], scale: number): { lines: PlacedLine[]; height: number } {
  const placed: PlacedLine[] = [];
  let rel = 0;
  let prevAdvance = 0;
  let first = true;
  const blankFor = (chunk: Chunk) => {
    if (chunk.gap === 'none') return 0;
    if (chunk.gap === 'title') {
      return BODY_LINE * (chunk.hug ? SPACING.titleHug : SPACING.title) * scale;
    }
    return chunk.hug ? 0 : BODY_LINE * SPACING.block * scale;
  };

  for (const chunk of chunks) {
    const size = chunk.style.size * scale;
    const advance = size * chunk.style.lh;
    chunk.lines.forEach((ln, j) => {
      if (first) {
        rel = 0;
        first = false;
      } else if (j === 0) {
        rel += prevAdvance + blankFor(chunk);
      } else {
        rel += advance;
      }
      placed.push({
        runs: ln.runs,
        x: ln.x,
        baseline: rel,
        size,
        bold: chunk.style.bold,
        marker: ln.marker,
      });
      prevAdvance = advance;
    });
  }

  if (!placed.length) return { lines: [], height: 0 };
  const height = ASCENT * placed[0].size + rel + DESCENT * placed[placed.length - 1].size;
  return { lines: placed, height };
}

function layoutAt(tile: Tile, scale: number, m: Measure): { lines: PlacedLine[]; height: number } {
  return stitch(tileChunks(tile, scale, m), scale);
}

/**
 * Lay a tile out, shrinking until the stack fits the 824px band.
 * Returns absolute baselines, so callers just draw.
 */
export function layoutTile(tile: Tile, m: Measure): TileLayout {
  const authored = Math.min(1.15, Math.max(0.7, tile.layout?.scale ?? 1));

  let scale = authored;
  let result = layoutAt(tile, scale, m);
  let overLong = false;

  if (result.height > BAND_H) {
    const floor = FIT_FLOOR * authored;
    if (layoutAt(tile, floor, m).height > BAND_H) {
      scale = floor;
      result = layoutAt(tile, scale, m);
      overLong = true;
    } else {
      let lo = floor;
      let hi = authored;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (layoutAt(tile, mid, m).height <= BAND_H) lo = mid;
        else hi = mid;
      }
      scale = lo;
      result = layoutAt(tile, scale, m);
    }
  }

  // Anchor the stack.
  const lines = result.lines;
  let offset: number;
  if (tile.role === 'hook') {
    offset = HOOK_BASELINE_1;
  } else {
    const bottom = tile.layout?.bottom ?? BAND_BOTTOM;
    const last = lines[lines.length - 1];
    offset = last ? bottom - DESCENT * last.size - last.baseline : bottom;
  }

  return {
    lines: lines.map((l) => ({ ...l, baseline: l.baseline + offset })),
    height: result.height,
    scale,
    overLong,
  };
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

export const fontFor = (size: number, bold: boolean) =>
  `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`;

export const measurerFor = (ctx: CanvasRenderingContext2D): Measure => (text, size, bold) => {
  ctx.font = fontFor(size, bold);
  return ctx.measureText(text).width;
};

export function paintTile(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  paper: CanvasImageSource | null,
): TileLayout {
  ctx.clearRect(0, 0, CANVAS, CANVAS);
  if (paper) ctx.drawImage(paper, 0, 0, CANVAS, CANVAS);
  else {
    ctx.fillStyle = '#e8e6e1';
    ctx.fillRect(0, 0, CANVAS, CANVAS);
  }

  const layout = layoutTile(tile, measurerFor(ctx));
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';

  const emphasis = tile.layout?.emphasis ?? 'title';

  for (const line of layout.lines) {
    if (line.marker) {
      ctx.font = fontFor(line.size, false);
      ctx.fillText(line.marker.text, line.marker.x, line.baseline);
    }
    let x = line.x;
    for (const run of line.runs) {
      let bold = line.bold || run.bold;
      if (emphasis === 'none') bold = false;
      if (emphasis === 'body') bold = !bold;
      ctx.font = fontFor(line.size, bold);
      ctx.fillText(run.text, x, line.baseline);
      x += ctx.measureText(run.text).width;
    }
  }

  return layout;
}

export const exportName = (deck: Deck, index: number) =>
  `${deck.id}-${String(index + 1).padStart(2, '0')}-v${deck.iteration}.png`;
