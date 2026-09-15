import { NextResponse } from 'next/server';
import { TOKEN_COOKIE, TikTokError, config, freshen, postStatus, unseal } from '@/lib/tiktok';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where a publish got to.
 *
 * TikTok pulls the tiles asynchronously, so a publish_id is a receipt rather
 * than a result: this is how you find out whether the fetch succeeded.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const publishId = url.searchParams.get('publish_id');
  if (!publishId) return NextResponse.json({ error: 'publish_id is required' }, { status: 400 });

  try {
    const cfg = config(url.origin);
    const session = unseal(
      req.headers.get('cookie')?.match(new RegExp(`${TOKEN_COOKIE}=([^;]+)`))?.[1],
      cfg.clientSecret,
    );
    if (!session) return NextResponse.json({ error: 'not connected to TikTok' }, { status: 401 });

    const { session: live } = await freshen(cfg, session);
    return NextResponse.json(await postStatus(live.accessToken, publishId));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), logId: e instanceof TikTokError ? e.logId : undefined },
      { status: 502 },
    );
  }
}
