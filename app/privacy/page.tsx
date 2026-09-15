import Link from 'next/link';
import { CONTACT_EMAIL, LAST_UPDATED, OPERATOR } from '@/lib/legal';

export const metadata = {
  title: 'Privacy Policy · Notice Content Studio',
  description: 'What Notice Content Studio stores, and what it does not.',
};

export default function Privacy() {
  return (
    <main className="wrap doc">
      <div className="masthead">
        <Link className="back" href="/">
          ← Studio
        </Link>
        <h1>Privacy Policy</h1>
        <span className="sub">Last updated {LAST_UPDATED}</span>
      </div>

      <p className="lede">
        {OPERATOR} is a private tool used by one operator to prepare and publish their own social
        media posts. It has no public sign-up, no user accounts, and no analytics. This policy
        describes the only personal data it touches: the TikTok credentials of the account its
        operator connects.
      </p>

      <h2>What is collected</h2>
      <p>
        When the operator connects a TikTok account, TikTok returns an access token, a refresh
        token, and an account identifier. Those three values are the entirety of what this tool
        holds. It requests two permissions and no others:
      </p>
      <ul>
        <li>
          <code>user.info.basic</code> — confirms which account authorized the connection.
        </li>
        <li>
          <code>video.upload</code> — sends prepared images to that account as a draft, for the
          account holder to review and publish inside TikTok.
        </li>
      </ul>
      <p>
        No profile information, follower data, post history, analytics, or content belonging to any
        other person is requested or retrieved.
      </p>

      <h2>Where it is stored</h2>
      <p>
        There is no database. The tokens are encrypted with AES-256-GCM and held in a single{' '}
        <code>httpOnly</code> cookie in the operator&rsquo;s own browser. They are never written to
        a server, a log, or a third-party service. A consequence of this design is that only the
        browser that authorized the connection can use it.
      </p>

      <h2>What is sent to TikTok</h2>
      <p>
        On publish, this tool sends TikTok a list of image URLs and the caption text for the post.
        TikTok then fetches those images from this site directly. The images are rendered from text
        files held by the operator and contain no personal data about anyone.
      </p>

      <h2>What is never done</h2>
      <ul>
        <li>No data is sold, rented, or shared with advertisers or data brokers.</li>
        <li>No analytics, tracking pixels, fingerprinting, or advertising identifiers are used.</li>
        <li>No data about TikTok users other than the connected account is collected.</li>
        <li>No email lists, newsletters, or marketing communications exist.</li>
      </ul>

      <h2>Retention and removal</h2>
      <p>
        Because the credentials live only in a browser cookie, clearing that browser&rsquo;s cookies
        deletes them outright. The connection can also be revoked at any time from TikTok&rsquo;s own
        settings, under Security and login, Manage app permissions — which invalidates the tokens
        regardless of what this tool holds. No copy survives either action.
      </p>

      <h2>Children</h2>
      <p>
        This tool is not directed at children and is not usable without a TikTok developer account.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the revision date above changes with it. Material changes to what is
        collected would require re-authorizing the TikTok connection in any case.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>

      <p className="foot">
        <Link href="/terms">Terms of Service</Link>
      </p>
    </main>
  );
}
