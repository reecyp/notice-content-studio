import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import type { Deck } from './types';

/**
 * The TikTok Content Posting API, as much of it as a photo carousel needs.
 *
 * Two things shape this file. First, TikTok will not accept photo bytes: a
 * photo post carries URLs, and TikTok pulls them from a domain the app has
 * proved it owns, which is why tiles are served by /api/tile rather than
 * uploaded. Second, the refresh token lives in an encrypted cookie on the one
 * browser that authorized it, rather than in the database, so the studio needs
 * no login of its own. That is a deliberate trade and it has a price: nothing
 * server-initiated can publish. See docs/database.md.
 */

const AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const CONTENT_INIT = 'https://open.tiktokapis.com/v2/post/publish/content/init/';
const STATUS_FETCH = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

/** Drafts only. Direct posting to the feed needs video.publish and a heavier audit. */
export const SCOPES = 'user.info.basic,video.upload';

export const TOKEN_COOKIE = 'tiktok_session';
export const STATE_COOKIE = 'tiktok_state';

export class TikTokError extends Error {
  constructor(message: string, readonly logId?: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type Config = {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  /** Origin TikTok fetches tiles from. Must be public https on a verified prefix. */
  publicBase: string;
  /**
   * A photo post accepts only WebP and JPEG, never PNG. WebP holds sharp serif
   * text on a textured ground better at the same size, so it is the default;
   * set TIKTOK_IMAGE_FORMAT=jpeg if a pull ever fails on it.
   */
  imageFormat: 'webp' | 'jpeg';
};

/**
 * Both URLs fall back to the origin the request arrived on, so a fresh Vercel
 * deployment works without configuring anything. Set them explicitly when the
 * public hostname differs from the one serving the studio.
 */
export function config(origin: string): Config {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new TikTokError('TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are not set');
  }
  return {
    clientKey,
    clientSecret,
    redirectUri: process.env.TIKTOK_REDIRECT_URI || `${origin}/api/tiktok/callback`,
    publicBase: (process.env.TIKTOK_PUBLIC_BASE || origin).replace(/\/$/, ''),
    imageFormat: process.env.TIKTOK_IMAGE_FORMAT === 'jpeg' ? 'jpeg' : 'webp',
  };
}

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------

export type Session = {
  openId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
};

// The client secret never leaves the server, so it doubles as the cookie key.
const keyFrom = (secret: string) => createHash('sha256').update(secret).digest();

export function seal(session: Session, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unseal(raw: string | undefined, secret: string): Session | null {
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const json = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
    return JSON.parse(json) as Session;
  } catch {
    // A rotated secret or a tampered cookie reads as simply not connected.
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function authorizeUrl(cfg: Config, state: string): string {
  const q = new URLSearchParams({
    client_key: cfg.clientKey,
    scope: SCOPES,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `${AUTHORIZE}?${q}`;
}

type TokenResponse = {
  open_id?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  log_id?: string;
};

async function token(cfg: Config, body: Record<string, string>): Promise<Session> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: cfg.clientKey,
      client_secret: cfg.clientSecret,
      ...body,
    }),
    cache: 'no-store',
  });

  const json = (await res.json()) as TokenResponse;
  if (json.error || !json.access_token || !json.refresh_token) {
    throw new TikTokError(
      json.error_description || json.error || `token endpoint returned ${res.status}`,
      json.log_id,
    );
  }

  return {
    openId: json.open_id ?? '',
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // A minute of headroom, so a token cannot expire mid-publish.
    expiresAt: Date.now() + ((json.expires_in ?? 86400) - 60) * 1000,
  };
}

export const exchangeCode = (cfg: Config, code: string) =>
  token(cfg, { code, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri });

export const refresh = (cfg: Config, refreshToken: string) =>
  token(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });

/**
 * A session good for at least the next minute.
 *
 * Refresh tokens rotate: TikTok may hand back a different one, and the old one
 * is then spent. `changed` tells the caller to write the cookie again.
 */
export async function freshen(
  cfg: Config,
  session: Session,
): Promise<{ session: Session; changed: boolean }> {
  if (Date.now() < session.expiresAt) return { session, changed: false };
  const next = await refresh(cfg, session.refreshToken);
  return { session: { ...next, openId: next.openId || session.openId }, changed: true };
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/** Where TikTok will fetch each tile of a deck. One-based, matching exportName(). */
export const tileUrls = (cfg: Config, deck: Deck): string[] =>
  deck.tiles.map(
    (_, i) => `${cfg.publicBase}/api/tile/${deck.id}/${i + 1}.${cfg.imageFormat === 'jpeg' ? 'jpg' : 'webp'}`,
  );

/** The caption, as one string: description first, hashtags after. */
export function caption(deck: Deck): string {
  const tags = (deck.post?.hashtags ?? []).map((h) => `#${h}`).join(' ');
  return [deck.post?.description?.trim(), tags].filter(Boolean).join('\n\n');
}

type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string; log_id?: string } };

async function call<T>(url: string, accessToken: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const json = (await res.json()) as ApiEnvelope<T>;
  const code = json.error?.code;
  if (code && code !== 'ok') {
    throw new TikTokError(`${code}: ${json.error?.message ?? 'no message'}`, json.error?.log_id);
  }
  if (!json.data) throw new TikTokError(`empty response from ${url} (${res.status})`);
  return json.data;
}

/**
 * Hand a whole deck to TikTok as a photo carousel.
 *
 * MEDIA_UPLOAD rather than DIRECT_POST: TikTok pulls the tiles, then notifies
 * the account holder, who finishes the post inside TikTok's own editor. That
 * keeps the caption and the privacy choice where a person can see them, and it
 * is the mode the video.upload scope covers.
 */
export async function sendToDrafts(
  cfg: Config,
  accessToken: string,
  deck: Deck,
): Promise<{ publishId: string; urls: string[] }> {
  const urls = tileUrls(cfg, deck);
  const text = caption(deck);

  const data = await call<{ publish_id: string }>(CONTENT_INIT, accessToken, {
    media_type: 'PHOTO',
    post_mode: 'MEDIA_UPLOAD',
    post_info: {
      // TikTok caps the title at 90 UTF-16 runes and the description at 4000.
      title: text.split('\n')[0].slice(0, 90),
      description: text.slice(0, 4000),
    },
    source_info: {
      source: 'PULL_FROM_URL',
      photo_images: urls,
      photo_cover_index: 0,
    },
  });

  return { publishId: data.publish_id, urls };
}

export type PostStatus = { status: string; failReason?: string; publiclyAvailablePostId?: string[] };

export async function postStatus(accessToken: string, publishId: string): Promise<PostStatus> {
  const data = await call<{
    status: string;
    fail_reason?: string;
    publicaly_available_post_id?: string[];
    publicly_available_post_id?: string[];
  }>(STATUS_FETCH, accessToken, { publish_id: publishId });

  return {
    status: data.status,
    failReason: data.fail_reason,
    // The field has shipped under both spellings; accept either.
    publiclyAvailablePostId: data.publicly_available_post_id ?? data.publicaly_available_post_id,
  };
}
