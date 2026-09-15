'use client';

import { useEffect, useRef } from 'react';
import { CANVAS, FONT_FAMILY, TYPE, paintTile, type TileLayout } from '@/lib/render';
import type { Tile } from '@/lib/types';

let paperPromise: Promise<HTMLImageElement | null> | null = null;
let fontPromise: Promise<void> | null = null;

/** One shared decode of the paper texture for every canvas on the page. */
export function loadPaper(): Promise<HTMLImageElement | null> {
  if (!paperPromise) {
    paperPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = '/paper.png';
    });
  }
  return paperPromise;
}

/**
 * Both faces, resolved before anything measures text.
 *
 * measureText silently falls back to whatever is already available, so a tile
 * painted before the webfont lands would wrap at the wrong widths and settle
 * the fit pass at the wrong scale. Every size shares one set of metrics, so
 * loading a single representative size per weight is enough.
 */
export function loadFonts(): Promise<void> {
  if (!fontPromise) {
    const faces = [`${TYPE.body.size}px "${FONT_FAMILY}"`, `bold ${TYPE.title.size}px "${FONT_FAMILY}"`];
    fontPromise = Promise.all(faces.map((f) => document.fonts.load(f)))
      .then(() => undefined)
      .catch(() => undefined);
  }
  return fontPromise;
}

/** Everything a paint needs. Callers must await this before paintTile. */
export async function loadAssets(): Promise<HTMLImageElement | null> {
  const [paper] = await Promise.all([loadPaper(), loadFonts()]);
  return paper;
}

export default function TileCanvas({
  tile,
  onLayout,
  className,
}: {
  tile: Tile;
  onLayout?: (layout: TileLayout) => void;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cb = useRef(onLayout);
  cb.current = onLayout;

  useEffect(() => {
    let cancelled = false;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    loadAssets().then((paper) => {
      if (cancelled) return;
      const layout = paintTile(ctx, tile, paper);
      cb.current?.(layout);
    });

    return () => {
      cancelled = true;
    };
  }, [tile]);

  return <canvas ref={ref} width={CANVAS} height={CANVAS} className={className} />;
}
