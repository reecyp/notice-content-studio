import type { SendState } from './db';

/**
 * TikTok's publish statuses, and what they mean for a photo carousel sent with
 * post_mode MEDIA_UPLOAD.
 *
 * The flow does not end at PUBLISH_COMPLETE. TikTok pulls the tiles
 * (PROCESSING_DOWNLOAD), then drops a notification in the account holder's
 * inbox and stops at SEND_TO_USER_INBOX — that is success, and the deck is
 * sitting in TikTok waiting to be finished by hand. PUBLISH_COMPLETE only
 * arrives later, if and when that notification is tapped and the post actually
 * goes up, which may be days later or never.
 */
export const TERMINAL = ['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE', 'FAILED'];

/** Whether TikTok is still working on it, so a poller knows to keep asking. */
export const inFlight = (status: string | null | undefined) =>
  Boolean(status) && !TERMINAL.includes(status as string);

/** One sentence, for the deck page. */
export function describe(status: string | null | undefined, failReason?: string): string {
  switch (status) {
    case 'PROCESSING':
    case 'PROCESSING_DOWNLOAD':
      return 'TikTok is fetching the tiles';
    case 'PROCESSING_UPLOAD':
      return 'TikTok is processing the upload';
    case 'SEND_TO_USER_INBOX':
      return 'Waiting in your TikTok inbox. Open the notification to finish the post.';
    case 'PUBLISH_COMPLETE':
      return 'Posted from your inbox';
    case 'FAILED':
      return `Failed${failReason ? `: ${failReason}` : ''}`;
    default:
      return status ?? 'unknown';
  }
}

/** Two words, for a card in the library. */
export function pill(state: SendState | undefined): { tone: string; label: string } {
  if (!state || (!state.sentAt && !state.lastStatus)) return { tone: '', label: 'not sent' };
  if (!state.sentAt) return { tone: 'failed', label: 'failed' };

  switch (state.lastStatus) {
    case 'PUBLISH_COMPLETE':
      return { tone: 'sent', label: `posted ${day(state.sentAt)}` };
    case 'SEND_TO_USER_INBOX':
      return { tone: 'sent', label: `in inbox ${day(state.sentAt)}` };
    default:
      // Sent, but TikTok has not finished pulling the tiles yet.
      return { tone: 'pending', label: 'pulling' };
  }
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
