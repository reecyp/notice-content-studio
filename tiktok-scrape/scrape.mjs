#!/usr/bin/env node
// scrape.mjs — pull the slideshows off a TikTok account and read the text off them.
//
//   node scrape.mjs @handle
//   node scrape.mjs @handle --limit 60
//   node scrape.mjs @handle --limit 100 --min-views 100000   only the ones that hit
//   node scrape.mjs https://www.tiktok.com/@handle/photo/123   one post
//
// Three stages, all local:
//   1. bin/yt-dlp_macos lists the account's posts
//   2. each post page is fetched and its embedded JSON parsed for the slide images
//   3. bin/ocr (Apple Vision) reads the words off each slide
//
// Why the post pages are fetched here rather than left to yt-dlp: yt-dlp knows a photo
// post exists but only offers its audio track as a download, so the slides never arrive.
// The images are sitting in the page's __UNIVERSAL_DATA_FOR_REHYDRATION__ blob, along
// with the caption and the real play count, so this reads them straight out of there.
//
// None of this is an official API, it is the same JSON the tiktok.com front end reads.
// So it breaks when TikTok changes something. If a run comes back empty, run ./setup.sh
// to update yt-dlp before assuming the account is the problem.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const YTDLP = join(HERE, "bin", "yt-dlp_macos");
const OCR = join(HERE, "bin", "ocr");
const OUTPUT = join(HERE, "output");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// TikTok is fine with a steady trickle and unfriendly about a flood.
const DELAY_MS = 1200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { target: null, limit: 30, minViews: 0, cookies: null, refresh: false, audio: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--min-views") args.minViews = Number(argv[++i]);
    else if (arg === "--cookies") args.cookies = argv[++i];
    else if (arg === "--refresh") args.refresh = true;
    else if (arg === "--audio") args.audio = true;
    else if (!arg.startsWith("--")) args.target = arg;
  }
  return args;
}

function normaliseTarget(target) {
  if (!target) return null;
  const handle = (target.match(/@([^/?#]+)/)?.[1] || target.replace(/^@/, "")).trim();
  const id = target.match(/\/(?:photo|video)\/(\d+)/)?.[1];
  return { handle, singleId: id || null };
}

// ---------------------------------------------------------------- listing

async function listPostIds(handle, { limit, cookies }) {
  const flags = [
    `https://www.tiktok.com/@${handle}`,
    "--flat-playlist",
    "--no-warnings",
    "--ignore-errors",
    "--playlist-end", String(limit),
    "--print", "%(id)s",
  ];
  if (cookies) flags.push("--cookies-from-browser", cookies);

  try {
    const { stdout } = await run(YTDLP, flags, { maxBuffer: 32 * 1024 * 1024 });
    return stdout.split("\n").map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
  } catch (error) {
    const tail = String(error.stderr || error.message).trim().split("\n").slice(-4).join("\n");
    console.log(`could not list posts:\n${tail}`);
    return [];
  }
}

// ---------------------------------------------------------------- one post

async function fetchPost(handle, id) {
  // The /video/ form is the one the extractor and the site both answer on, even for
  // photo posts. The /photo/ form returns a stripped page.
  const url = `https://www.tiktok.com/@${handle}/video/${id}`;
  const response = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("no data blob in page (TikTok may be showing a bot check)");

  const scope = JSON.parse(match[1]).__DEFAULT_SCOPE__ ?? {};
  const item = scope["webapp.video-detail"]?.itemInfo?.itemStruct;
  if (!item) throw new Error("no post data in page");

  const stats = item.statsV2 ?? item.stats ?? {};
  const music = item.music ?? {};
  const soundSlug = (music.title ?? "sound").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return {
    id,
    url: `https://www.tiktok.com/@${handle}/photo/${id}`,
    sound: {
      title: music.title ?? "",
      author: music.authorName ?? "",
      // "original" means the poster's own upload rather than a track off the library.
      original: Boolean(music.original),
      duration: music.duration ?? null,
      // Any slug resolves, the id is the part that matters.
      url: music.id ? `https://www.tiktok.com/music/${soundSlug}-${music.id}` : "",
      fileUrl: music.playUrl ?? "",
    },
    caption: (item.desc ?? "").trim(),
    date: item.createTime ? new Date(Number(item.createTime) * 1000).toISOString().slice(0, 10) : "unknown-date",
    isSlideshow: Boolean(item.imagePost?.images?.length),
    imageUrls: (item.imagePost?.images ?? []).map((img) => img.imageURL?.urlList?.[0]).filter(Boolean),
    views: Number(stats.playCount ?? 0),
    likes: Number(stats.diggCount ?? 0),
    comments: Number(stats.commentCount ?? 0),
    shares: Number(stats.shareCount ?? 0),
    saves: Number(stats.collectCount ?? 0),
  };
}

async function downloadSlides(post, dir, refresh) {
  await mkdir(dir, { recursive: true });
  const paths = [];

  for (const [index, url] of post.imageUrls.entries()) {
    const name = `slide-${String(index + 1).padStart(2, "0")}.jpeg`;
    const path = join(dir, name);
    paths.push(path);

    if (existsSync(path) && !refresh) continue;

    const response = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://www.tiktok.com/" } });
    if (!response.ok) throw new Error(`slide ${index + 1}: HTTP ${response.status}`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }

  return paths;
}

// Opt in, because the sound link is what you actually need to reuse a sound: you
// attach it inside TikTok, you do not upload a file. The download is here for when
// you want the track itself for reference.
async function downloadSound(post, dir) {
  if (!post.sound.fileUrl) return null;
  const path = join(dir, "sound.mp3");
  if (existsSync(path)) return path;

  const response = await fetch(post.sound.fileUrl, {
    headers: { "User-Agent": UA, Referer: "https://www.tiktok.com/" },
  });
  if (!response.ok) throw new Error(`sound: HTTP ${response.status}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

async function readSlides(paths) {
  const { stdout } = await run(OCR, ["--json", ...paths], { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout)
    .map((result) => ({
      text: result.text.trim(),
      confidence: result.lines.length
        ? result.lines.reduce((sum, line) => sum + line.confidence, 0) / result.lines.length
        : 0,
    }))
    .filter((slide) => slide.text.length > 0);
}

// ---------------------------------------------------------------- writing

function postMarkdown(post, slides) {
  const lines = [
    `# ${slides[0]?.text.split("\n")[0] ?? "(no text on slide 1)"}`,
    "",
    `- **Posted:** ${post.date}`,
    `- **URL:** ${post.url}`,
    `- **Slides:** ${slides.length}`,
    `- **Stats:** ${post.views} views, ${post.likes} likes, ${post.comments} comments, ${post.shares} shares, ${post.saves} saves`,
    post.sound.title
      ? `- **Sound:** ${post.sound.title}${post.sound.author ? ` by ${post.sound.author}` : ""}` +
        `${post.sound.original ? " (their own upload)" : ""}` +
        `${post.sound.duration ? `, ${post.sound.duration}s` : ""}` +
        `${post.sound.url ? ` — ${post.sound.url}` : ""}`
      : null,
    "",
    "## Caption",
    "",
    post.caption || "(none)",
    "",
    "## Slides",
    "",
  ].filter((line) => line !== null);

  slides.forEach((slide, index) => {
    const flag = slide.confidence < 0.5 ? "  _(low confidence, check this one)_" : "";
    lines.push(`### Slide ${index + 1}${flag}`, "", slide.text, "");
  });

  return lines.join("\n");
}

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = normaliseTarget(args.target);

  if (!target) {
    console.log("usage: node scrape.mjs @handle [--limit 30] [--min-views 100000] [--cookies chrome] [--refresh]");
    process.exit(2);
  }
  for (const [label, path] of [["yt-dlp", YTDLP], ["ocr", OCR]]) {
    if (!existsSync(path)) {
      console.log(`missing ${label} at ${path}. Run ./setup.sh first.`);
      process.exit(1);
    }
  }

  const ids = target.singleId
    ? [target.singleId]
    : await listPostIds(target.handle, args);

  if (ids.length === 0) {
    console.log("no posts found. If the account is real, try --cookies chrome");
    process.exit(1);
  }
  console.log(`${ids.length} posts to check on @${target.handle}\n`);

  const root = join(OUTPUT, target.handle);
  const postsDir = join(root, "posts");
  await mkdir(postsDir, { recursive: true });

  const index = [];
  let skipped = 0;
  let belowFloor = 0;

  for (const [n, id] of ids.entries()) {
    const label = `[${n + 1}/${ids.length}]`;
    try {
      const post = await fetchPost(target.handle, id);

      if (!post.isSlideshow) {
        skipped++;
        console.log(`${label} ${id}  video, not a slideshow, skipped`);
        await sleep(DELAY_MS);
        continue;
      }

      // The page fetch already carries the play count, so a floor here costs one
      // request and saves the slide downloads and the OCR on everything under it.
      if (post.views < args.minViews) {
        belowFloor++;
        console.log(`${label} ${post.date}  ${post.views} views, under the floor, skipped`);
        await sleep(DELAY_MS);
        continue;
      }

      const dir = join(root, "raw", `${post.date}_${id}`);
      const paths = await downloadSlides(post, dir, args.refresh);
      const slides = await readSlides(paths);
      if (args.audio) await downloadSound(post, dir);

      if (slides.length === 0) {
        console.log(`${label} ${id}  slides downloaded but no text read`);
        await sleep(DELAY_MS);
        continue;
      }

      await writeFile(join(postsDir, `${post.date}_${id}.md`), postMarkdown(post, slides), "utf8");

      const hook = slides[0].text.replace(/\n/g, " ").trim();
      index.push({ ...post, hook, slideCount: slides.length, file: `${post.date}_${id}.md` });
      console.log(`${label} ${post.date}  ${slides.length} slides  ${post.views} views  ${hook.slice(0, 55)}`);
    } catch (error) {
      console.log(`${label} ${id}  failed: ${error.message}`);
    }
    await sleep(DELAY_MS);
  }

  if (index.length === 0) {
    console.log(
      belowFloor > 0
        ? `\nno slideshows read. ${belowFloor} were under the ${args.minViews} view floor, try lowering it.`
        : "\nno slideshows read."
    );
    process.exit(1);
  }

  index.sort((a, b) => b.date.localeCompare(a.date));

  const byViews = [...index].sort((a, b) => b.views - a.views);
  const hooksMd = [
    `# Hooks — @${target.handle}`,
    "",
    `${index.length} slideshows, read on ${new Date().toISOString().slice(0, 10)}.`,
    `${skipped} posts skipped as ordinary videos.`,
    args.minViews > 0 ? `${belowFloor} slideshows skipped as under ${args.minViews} views.` : null,
    "",
    "## Best performing",
    "",
    "| Views | Hook (slide 1) | Slides | Date |",
    "|---|---|---|---|",
    ...byViews.slice(0, 15).map((r) => `| ${r.views} | ${r.hook.replace(/\|/g, "\\|")} | ${r.slideCount} | ${r.date} |`),
    "",
    "## Everything, newest first",
    "",
    "| Date | Hook (slide 1) | Slides | Views | Likes | Post |",
    "|---|---|---|---|---|---|",
    ...index.map((r) => `| ${r.date} | ${r.hook.replace(/\|/g, "\\|")} | ${r.slideCount} | ${r.views} | ${r.likes} | [open](${r.url}) |`),
    "",
  ].filter((line) => line !== null).join("\n");
  await writeFile(join(root, "hooks.md"), hooksMd, "utf8");

  const hooksCsv = [
    ["Date", "Hook", "Slides", "Views", "Likes", "Comments", "Shares", "Saves", "Sound", "Sound by", "Sound URL", "URL"].join(","),
    ...index.map((r) =>
      [r.date, r.hook, r.slideCount, r.views, r.likes, r.comments, r.shares, r.saves,
       r.sound.title, r.sound.author, r.sound.url, r.url].map(csvCell).join(",")
    ),
  ].join("\n");
  await writeFile(join(root, "hooks.csv"), hooksCsv, "utf8");

  console.log(`\n${index.length} slideshows written to output/${target.handle}/`);
  console.log(`  posts/     one markdown file per slideshow, every slide in order`);
  console.log(`  hooks.md   every hook in one table, best performing first`);
  console.log(`  hooks.csv  the same, for pasting into reel-tracker.xlsx`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
