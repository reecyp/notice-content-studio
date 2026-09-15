import Link from 'next/link';
import { CONTACT_EMAIL, LAST_UPDATED, OPERATOR } from '@/lib/legal';

export const metadata = {
  title: 'Terms of Service · Notice Content Studio',
  description: 'The terms under which Notice Content Studio is operated.',
};

export default function Terms() {
  return (
    <main className="wrap doc">
      <div className="masthead">
        <Link className="back" href="/">
          ← Studio
        </Link>
        <h1>Terms of Service</h1>
        <span className="sub">Last updated {LAST_UPDATED}</span>
      </div>

      <p className="lede">
        {OPERATOR} is a private tool that composes image posts and sends them to its
        operator&rsquo;s own TikTok account as drafts. It is not a product offered to the public,
        and there is no sign-up. These terms govern its operation.
      </p>

      <h2>What the tool does</h2>
      <p>
        It renders images from text files, and — when the operator chooses — hands those images to
        TikTok as a draft photo post. TikTok then notifies the account holder, who reviews, edits,
        and decides whether to publish inside TikTok&rsquo;s own app. Nothing is posted publicly
        without that step.
      </p>

      <h2>Permitted use</h2>
      <p>
        Only an account its operator owns or is authorized to manage may be connected. Connecting an
        account without the account holder&rsquo;s permission is not permitted, and neither is any
        use that would breach TikTok&rsquo;s Terms of Service, Community Guidelines, or developer
        terms.
      </p>

      <h2>Responsibility for content</h2>
      <p>
        The operator is solely responsible for everything composed with this tool and for whether it
        is published. This tool makes no judgement about content and applies no moderation;
        TikTok&rsquo;s own rules govern anything that reaches TikTok.
      </p>

      <h2>Availability</h2>
      <p>
        The tool is provided as-is, with no warranty of any kind and no guarantee of availability,
        accuracy, or fitness for any purpose. It may be changed, taken offline, or discontinued at
        any time without notice. It depends on TikTok&rsquo;s API, which may itself change or become
        unavailable.
      </p>

      <h2>Liability</h2>
      <p>
        To the fullest extent permitted by law, the operator is not liable for any indirect,
        incidental, or consequential loss arising from use of this tool, including failed or
        incomplete posts.
      </p>

      <h2>Privacy</h2>
      <p>
        Credential handling is described in the <Link href="/privacy">Privacy Policy</Link>, which
        forms part of these terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>

      <p className="foot">
        <Link href="/privacy">Privacy Policy</Link>
      </p>
    </main>
  );
}
