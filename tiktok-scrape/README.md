# tiktok-scrape

Pull the slideshows off a TikTok account and get the text of every slide, as markdown
you can read and a CSV you can paste into `reel-tracker.xlsx`.

Built for competitor research: what hook did they open with, how many slides, what was
the shape of the points. Read them, take the structure, write your own words.

## Use it

```bash
node scrape.mjs @someaccount              # 30 most recent posts
node scrape.mjs @someaccount --limit 60
node scrape.mjs @someaccount --limit 100 --min-views 100000   # only their winners
node scrape.mjs @someaccount --cookies chrome    # if TikTok asks who you are
node scrape.mjs https://www.tiktok.com/@someaccount/photo/123456   # one post
```

`--limit` is how far back to look, `--min-views` is the floor a post has to clear to be
kept. They work together: the two above mean "the last 100 posts, but only write up the
ones over 100k". The view count arrives with the post page, before any slide is
downloaded, so a floor makes the run faster rather than slower. Skipped posts are
counted at the top of `hooks.md` so you can see how much the floor cut.

Raise the limit when you raise the floor. On an account that posts daily, 30 posts is a
month, and a 100k floor over one month can leave you with two hooks.

Output lands in `output/@someaccount/`:

- `posts/` one markdown file per slideshow: caption, date, stats, then every slide's
  text in order
- `hooks.md` every hook in one table, newest first, so fifty openers fit on one screen
- `hooks.csv` the same table for the tracker spreadsheet
- `raw/` the downloaded images and metadata, kept so a re-read costs no downloads

## How it works

Three stages, all on this machine. No API key, no account, no service.

**1. Download.** `bin/yt-dlp_macos` is a standalone copy of yt-dlp, a widely used open
source downloader. It is not an official API: it asks TikTok for the same JSON the
TikTok website asks for, then pulls the media out of the answer. For a photo carousel
that means the individual slide images, plus a sidecar JSON with the caption, date, and
engagement counts.

**2. Read.** `ocr.swift`, compiled to `bin/ocr`, runs Apple's Vision framework over each
image. The text on a TikTok slideshow is baked into the picture, so there is no way to
get it except to read the pixels. Vision is built into macOS: free, offline, fast, and
very accurate on this kind of high contrast text. This is a command line script, not an
app. Nothing to do with SwiftUI or Xcode.

**3. Assemble.** `scrape.mjs` walks the downloads, sends the images through the OCR, and
writes the markdown and CSV.

`frames.swift` is a fallback. If a slideshow comes back as a single mp4 rather than
separate images, it samples a frame every half second; the glue then drops consecutive
frames whose text is identical, leaving one entry per slide.

## When it breaks

It will, eventually. TikTok changes their site and yt-dlp has to catch up.

```bash
./setup.sh      # updates yt-dlp and recompiles the OCR
```

If a run comes back with nothing, that is almost always the first thing to try. Second
thing is `--cookies chrome`, which lets yt-dlp borrow your logged in browser session for
accounts TikTok will not show to strangers.

Keep the volume sane. Scraping is against TikTok's terms of service, this is public data
being read for research, and hammering it is both rude and the fastest way to get the
IP rate limited.

## Checking the output

OCR is good but not perfect. Slides where it is unsure are flagged in the markdown with
_(low confidence, check this one)_. Text placed over a busy part of a photo is where it
struggles; plain text on a plain background comes back verbatim.

Note that line breaks in the output are the line breaks as displayed on the slide, not
as they were typed. A sentence that wrapped across three lines on the tile comes back as
three lines here.
