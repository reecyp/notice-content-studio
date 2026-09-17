'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TileCanvas, { loadAssets } from './TileCanvas';
import { CANVAS, exportName, paintTile, type TileLayout } from '@/lib/render';
import type { SendState } from '@/lib/db';
import { describe, inFlight } from '@/lib/send-state';
import type { Deck } from '@/lib/types';

/** Repaints a tile on a detached canvas so export never depends on what is on screen. */
async function tileBlob(deck: Deck, index: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS;
  canvas.height = CANVAS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintTile(ctx, deck.tiles[index], await loadAssets());
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type PostState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; publishId: string; status: string; failReason?: string }
  | { kind: 'error'; message: string };

export default function DeckViewer({ deck, sent }: { deck: Deck; sent?: SendState | null }) {
  const [index, setIndex] = useState(0);
  const [layouts, setLayouts] = useState<Record<number, TileLayout>>({});
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Seeded from the ledger, so a reload still knows what the last send was and
  // the status of a pull can be checked hours later.
  const [post, setPost] = useState<PostState>(
    sent?.lastPublishId
      ? { kind: 'sent', publishId: sent.lastPublishId, status: sent.lastStatus ?? 'PROCESSING' }
      : { kind: 'idle' },
  );
  const stripRef = useRef<HTMLDivElement>(null);

  const tile = deck.tiles[index];
  const layout = layouts[index];
  const count = deck.tiles.length;

  const record = useCallback((i: number, l: TileLayout) => {
    setLayouts((prev) => (prev[i]?.scale === l.scale && prev[i]?.overLong === l.overLong ? prev : { ...prev, [i]: l }));
  }, []);

  const go = useCallback(
    (next: number) => setIndex(Math.max(0, Math.min(count - 1, next))),
    [count],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'j') go(index + 1);
      if (e.key === 'ArrowLeft' || e.key === 'k') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index]);

  useEffect(() => {
    stripRef.current?.children[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [index]);

  const downloadOne = async () => {
    setBusy(true);
    const blob = await tileBlob(deck, index);
    if (blob) saveBlob(blob, exportName(deck, index));
    setBusy(false);
  };

  const downloadAll = async () => {
    setBusy(true);
    for (let i = 0; i < count; i++) {
      const blob = await tileBlob(deck, i);
      if (blob) saveBlob(blob, exportName(deck, i));
      // Browsers throttle rapid successive downloads.
      await new Promise((r) => setTimeout(r, 350));
    }
    setBusy(false);
  };

  /**
   * Hand the deck to TikTok. Nothing is uploaded: the server sends TikTok the
   * /api/tile URLs for this deck and TikTok fetches them itself, so the post
   * always reflects whatever the JSON says at the moment TikTok pulls.
   */
  const sendToTikTok = async () => {
    setPost({ kind: 'sending' });
    try {
      const res = await fetch('/api/tiktok/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deckId: deck.id }),
      });
      const body = await res.json();

      if (res.status === 401) {
        window.location.href = '/api/tiktok/auth';
        return;
      }
      if (!res.ok) {
        setPost({ kind: 'error', message: body.error ?? `request failed (${res.status})` });
        return;
      }
      setPost({ kind: 'sent', publishId: body.publishId, status: 'PROCESSING' });
    } catch (e) {
      setPost({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const checkStatus = useCallback(async () => {
    if (post.kind !== 'sent') return;
    const res = await fetch(`/api/tiktok/status?publish_id=${encodeURIComponent(post.publishId)}`);
    const body = await res.json();
    setPost(
      res.ok
        ? { ...post, status: body.status, failReason: body.failReason }
        : { kind: 'error', message: body.error ?? 'could not read status' },
    );
  }, [post]);

  /**
   * Chase a publish to its conclusion without anyone pressing a button.
   *
   * TikTok pulls the tiles on its own schedule, so the status right after a
   * send is never the final one. Polling stops the moment the status is
   * terminal, and gives up after two minutes rather than asking forever: the
   * ledger still learns the outcome on the next page load, and TikTok allows
   * only 6 requests a minute per token.
   */
  useEffect(() => {
    if (post.kind !== 'sent' || !inFlight(post.status)) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 120_000) return clearInterval(timer);
      void checkStatus();
    }, 5000);
    return () => clearInterval(timer);
  }, [post, checkStatus]);

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1400);
  };

  const hashtags = useMemo(
    () => (deck.post?.hashtags ?? []).map((h) => `#${h}`).join(' '),
    [deck.post?.hashtags],
  );

  const overLong = useMemo(
    () => Object.entries(layouts).filter(([, l]) => l.overLong).map(([i]) => Number(i) + 1),
    [layouts],
  );

  return (
    <div className="stage">
      <div>
        <div className="tile-frame">
          <TileCanvas tile={tile} onLayout={(l) => record(index, l)} />
          {layout?.overLong && <span className="flag">over-long</span>}
        </div>

        <div className="controls">
          <button onClick={() => go(index - 1)} disabled={index === 0}>
            ← Prev
          </button>
          <button onClick={() => go(index + 1)} disabled={index === count - 1}>
            Next →
          </button>
          <span className="counter">
            {index + 1} / {count}
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={downloadOne} disabled={busy}>
            Download tile
          </button>
          <button className="primary" onClick={downloadAll} disabled={busy}>
            {busy ? 'Exporting…' : `Download all ${count}`}
          </button>
        </div>

        <div className="filmstrip" ref={stripRef}>
          {deck.tiles.map((t, i) => (
            <button
              key={i}
              className={i === index ? 'on' : ''}
              onClick={() => setIndex(i)}
              title={`Tile ${i + 1}`}
            >
              <TileCanvas tile={t} onLayout={(l) => record(i, l)} />
              <span className="n">{i + 1}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="side">
        <section>
          <h3>Caption</h3>
          <p>{deck.post?.description || <em style={{ color: 'var(--muted)' }}>No description</em>}</p>
          {hashtags && (
            <div className="tags">
              {(deck.post?.hashtags ?? []).map((h) => (
                <span className="tag" key={h}>
                  #{h}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => copy('caption', deck.post?.description ?? '')}>
              {copied === 'caption' ? 'Copied' : 'Copy caption'}
            </button>
            <button onClick={() => copy('tags', hashtags)} disabled={!hashtags}>
              {copied === 'tags' ? 'Copied' : 'Copy tags'}
            </button>
          </div>
        </section>

        <section>
          <h3>TikTok</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 10px' }}>
            Sends all {count} tiles as a photo carousel. TikTok pulls the images and notifies you
            to finish the post in the app.
          </p>
          {sent && (
            <p style={{ fontSize: 13, margin: '0 0 10px' }}>
              {sent.sentAt ? (
                <>
                  Sent {new Date(sent.sentAt).toLocaleString('en-GB')}
                  {sent.sendCount > 1 ? ` · ${sent.sendCount} sends` : ''}
                </>
              ) : (
                <span style={{ color: 'var(--muted)' }}>
                  Not sent yet{sent.sendCount > 0 ? ` · ${sent.sendCount} failed attempt${sent.sendCount === 1 ? '' : 's'}` : ''}
                </span>
              )}
            </p>
          )}
          <button
            className="primary"
            onClick={sendToTikTok}
            disabled={post.kind === 'sending' || overLong.length > 0}
          >
            {post.kind === 'sending' ? 'Sending…' : 'Send to TikTok'}
          </button>
          {overLong.length > 0 && (
            <p style={{ color: 'var(--warn)', fontSize: 13, margin: '10px 0 0' }}>
              Fix the over-long tiles first.
            </p>
          )}
          {post.kind === 'sent' && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <div style={{ color: 'var(--muted)' }}>publish id</div>
              <div style={{ wordBreak: 'break-all', margin: '2px 0 8px' }}>{post.publishId}</div>
              <div style={{ color: 'var(--muted)' }}>status</div>
              <div style={{ margin: '2px 0 8px' }}>{describe(post.status, post.failReason)}</div>
              <button onClick={checkStatus}>
                {inFlight(post.status) ? 'Checking…' : 'Refresh status'}
              </button>
            </div>
          )}
          {post.kind === 'error' && (
            <p style={{ color: 'var(--warn)', fontSize: 13, margin: '10px 0 0' }}>{post.message}</p>
          )}
        </section>

        <section>
          <h3>Deck</h3>
          <dl>
            <dt>id</dt>
            <dd>{deck.id}</dd>
            <dt>uid</dt>
            <dd style={{ fontSize: 11, wordBreak: 'break-all' }}>{deck.uid}</dd>
            <dt>iteration</dt>
            <dd>v{deck.iteration}</dd>
            <dt>tiles</dt>
            <dd>{count}</dd>
            <dt>export</dt>
            <dd style={{ fontSize: 12 }}>{exportName(deck, index)}</dd>
          </dl>
        </section>

        <section>
          <h3>Fit</h3>
          <dl>
            <dt>scale</dt>
            <dd>{layout ? `${(layout.scale * 100).toFixed(0)}%` : '—'}</dd>
            <dt>stack</dt>
            <dd>{layout ? `${Math.round(layout.height)} / 824px` : '—'}</dd>
          </dl>
          {overLong.length > 0 && (
            <p style={{ color: 'var(--warn)', margin: '12px 0 0', fontSize: 13 }}>
              Over-long: {overLong.map((n) => `tile ${n}`).join(', ')}. Split the copy rather than
              shipping a shrunk tile.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
