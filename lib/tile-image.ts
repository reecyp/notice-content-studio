import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, GlobalFonts, loadImage, type Image } from '@napi-rs/canvas';
import { CANVAS, FONT_FAMILY, paintTile, type TileLayout } from './render';
import type { Tile } from './types';

/**
 * Server-side twin of the browser paint.
 *
 * lib/render.ts holds the whole layout grammar and takes its text measurements
 * through an injected Measure, so nothing here re-implements geometry: this
 * file only supplies the same font files and the same paper that the browser
 * gets, then hands paintTile a 2D context. Identical inputs, identical output.
 */

const ASSETS = path.join(process.cwd(), 'public');

let registered = false;

/**
 * Both faces under the private family name, matching the @font-face pair in
 * globals.css. Skia picks the weight off each file's own metadata, so the two
 * register under one alias.
 */
function registerFonts() {
  if (registered) return;
  for (const file of ['LiberationSerif-Regular.ttf', 'LiberationSerif-Bold.ttf']) {
    const ok = GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', file), FONT_FAMILY);
    if (!ok) throw new Error(`could not register ${file}; tiles would render in a fallback face`);
  }
  registered = true;
}

let paperPromise: Promise<Image | null> | null = null;

function loadPaper(): Promise<Image | null> {
  if (!paperPromise) {
    paperPromise = readFile(path.join(ASSETS, 'paper.png'))
      .then((buf) => loadImage(buf))
      .catch(() => null);
  }
  return paperPromise;
}

/**
 * PNG is lossless and what the download bar hands you. TikTok will not take it
 * — a photo post accepts only WebP and JPEG — so the same tile is encodable
 * either way and the caller picks by file extension.
 */
export const FORMATS = {
  png: { mime: 'image/png' },
  webp: { mime: 'image/webp', quality: 92 },
  jpeg: { mime: 'image/jpeg', quality: 92 },
} as const;

export type Format = keyof typeof FORMATS;

export const isFormat = (v: string): v is Format => v in FORMATS;

export type RenderedTile = { bytes: Buffer; mime: string; layout: TileLayout };

export async function renderTile(tile: Tile, format: Format = 'png'): Promise<RenderedTile> {
  registerFonts();
  const paper = await loadPaper();
  const canvas = createCanvas(CANVAS, CANVAS);
  const ctx = canvas.getContext('2d');

  // @napi-rs/canvas implements the same 2D surface paintTile draws through;
  // only the nominal types differ between the DOM and native declarations.
  const layout = paintTile(
    ctx as unknown as CanvasRenderingContext2D,
    tile,
    paper as unknown as CanvasImageSource | null,
  );

  const spec = FORMATS[format];
  const bytes =
    format === 'png'
      ? await canvas.encode('png')
      : await canvas.encode(format, (spec as { quality: number }).quality);

  return { bytes, mime: spec.mime, layout };
}
