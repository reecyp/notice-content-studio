import type { SendState } from './db';

/** How a video's send state reads on a card: the pill class and its label. */
export function pill(state: SendState | undefined): { tone: string; label: string } {
  if (!state || (!state.sentAt && !state.lastStatus)) return { tone: '', label: 'not sent' };
  if (state.sentAt && state.lastStatus === 'PUBLISH_COMPLETE') {
    return { tone: 'sent', label: `sent ${day(state.sentAt)}` };
  }
  // Sent, but TikTok has not finished pulling the tiles, so it is not in drafts yet.
  if (state.sentAt) return { tone: 'pending', label: 'pulling' };
  return { tone: 'failed', label: 'failed' };
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
