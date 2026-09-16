import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Block, Deck, Point, Tile } from './types';
import { BLOCK_KINDS, TILE_ROLES } from './types';

const DECKS_DIR = path.join(process.cwd(), 'decks');

class DeckError extends Error {}

const fail = (where: string, msg: string): never => {
  throw new DeckError(`${where}: ${msg}`);
};

const isStr = (v: unknown): v is string => typeof v === 'string';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const strArray = (v: unknown, where: string): string[] => {
  if (!Array.isArray(v) || !v.every(isStr)) fail(where, 'expected an array of strings');
  return v as string[];
};

function parseBlock(raw: unknown, where: string): Block {
  if (!raw || typeof raw !== 'object') fail(where, 'expected an object');
  const b = raw as Record<string, unknown>;
  const kind = b.kind;
  if (!isStr(kind) || !(BLOCK_KINDS as readonly string[]).includes(kind)) {
    fail(where, `kind must be one of ${BLOCK_KINDS.join(', ')}, got ${JSON.stringify(kind)}`);
  }
  const hug = b.hug === true ? true : undefined;

  if (kind === 'bullets') {
    const items = strArray(b.items, `${where}.items`);
    if (!items.length) fail(`${where}.items`, 'needs at least one item');
    return { kind, items, hug };
  }
  if (kind === 'lines') {
    const lines = strArray(b.lines, `${where}.lines`);
    if (!lines.length) fail(`${where}.lines`, 'needs at least one line');
    return { kind, lines, hug };
  }
  if (!isStr(b.text)) fail(`${where}.text`, 'expected a string');
  return { kind: kind as 'paragraph' | 'lead', text: b.text as string, hug };
}

function parseBody(raw: unknown, where: string): Block[] {
  if (!Array.isArray(raw)) {
    fail(where, 'body must be an array of blocks (schema v2). A bare object is v1 and no longer renders.');
  }
  const arr = raw as unknown[];
  if (!arr.length) fail(where, 'body needs at least one block');
  return arr.map((b, i) => parseBlock(b, `${where}[${i}]`));
}

function parsePoint(raw: unknown, where: string): Point {
  if (!raw || typeof raw !== 'object') fail(where, 'expected an object');
  const p = raw as Record<string, unknown>;
  if (p.titleSub !== undefined && p.title === undefined) {
    fail(where, 'titleSub requires a title');
  }
  return {
    number: typeof p.number === 'number' ? p.number : undefined,
    title: isStr(p.title) ? p.title : undefined,
    titleSub: isStr(p.titleSub) ? p.titleSub : undefined,
    body: parseBody(p.body, `${where}.body`),
  };
}

function parseTile(raw: unknown, where: string): Tile {
  if (!raw || typeof raw !== 'object') fail(where, 'expected an object');
  const t = raw as Record<string, unknown>;
  const role = t.role;
  if (!isStr(role) || !(TILE_ROLES as readonly string[]).includes(role)) {
    fail(where, `role must be one of ${TILE_ROLES.join(', ')}, got ${JSON.stringify(role)}`);
  }
  const layout = (t.layout ?? undefined) as Tile['layout'];

  if (role === 'hook') {
    if (t.lead !== undefined || t.punch !== undefined) {
      fail(where, 'lead/punch is v1. Use "lines": ["...", "**...**"] instead.');
    }
    const lines = strArray(t.lines, `${where}.lines`);
    if (!lines.length || lines.length > 2) fail(`${where}.lines`, 'a hook is one or two lines');
    return { role, lines, layout };
  }
  if (role === 'point') {
    if (!Array.isArray(t.points) || !t.points.length) fail(`${where}.points`, 'expected a non-empty array');
    return {
      role,
      points: (t.points as unknown[]).map((p, i) => parsePoint(p, `${where}.points[${i}]`)),
      layout,
    };
  }
  if (role === 'closer') {
    return {
      role,
      title: isStr(t.title) ? t.title : undefined,
      titleSub: isStr(t.titleSub) ? t.titleSub : undefined,
      body: parseBody(t.body, `${where}.body`),
      layout,
    };
  }
  return {
    role: 'endcard',
    headline: isStr(t.headline) ? t.headline : undefined,
    body: isStr(t.body) ? t.body : undefined,
    handle: isStr(t.handle) ? t.handle : undefined,
    layout,
  };
}

export function parseDeck(raw: unknown, filename: string): Deck {
  if (!raw || typeof raw !== 'object') fail(filename, 'expected a JSON object');
  const d = raw as Record<string, unknown>;

  if (d.schemaVersion !== 2) {
    fail(filename, `schemaVersion must be 2, got ${JSON.stringify(d.schemaVersion)}`);
  }
  if (!isStr(d.id)) return fail(filename, 'id is required');
  const expected = path.basename(filename, '.json');
  if (d.id !== expected) fail(filename, `id "${d.id}" does not match the filename "${expected}"`);
  if (!isStr(d.uid) || !UUID.test(d.uid)) {
    // Stamped once and never edited: it is the row the send log hangs off, so a
    // deck without one is invisible to the queue rather than merely unlabelled.
    fail(filename, 'uid must be a UUID. Run `npm run uid` to stamp any deck missing one.');
  }
  if (typeof d.iteration !== 'number' || d.iteration < 1) {
    return fail(filename, 'iteration must be an integer of 1 or more');
  }
  if (d.format !== 'paper-note') fail(filename, 'format must be "paper-note"');
  if (!Array.isArray(d.tiles)) return fail(filename, 'tiles must be a non-empty array');
  const tiles = d.tiles as unknown[];
  if (!tiles.length) fail(filename, 'tiles must be a non-empty array');
  if (tiles.length > 35) fail(filename, 'TikTok caps a photo post at 35 tiles');

  const post = (d.post ?? undefined) as Deck['post'];
  if (post?.hashtags?.some((h) => h.startsWith('#'))) {
    fail(filename, 'hashtags carry no leading "#", the site adds it');
  }

  return {
    schemaVersion: 2,
    id: d.id,
    uid: (d.uid as string).toLowerCase(),
    iteration: d.iteration,
    format: 'paper-note',
    post,
    tiles: tiles.map((t, i) => parseTile(t, `${filename} tiles[${i}]`)),
  };
}

export type DeckLoad = { deck: Deck } | { id: string; error: string };

export async function listDeckFiles(): Promise<string[]> {
  try {
    const entries = await readdir(DECKS_DIR);
    return entries.filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

export async function loadDeck(id: string): Promise<DeckLoad> {
  const file = `${id}.json`;
  try {
    const raw = await readFile(path.join(DECKS_DIR, file), 'utf8');
    return { deck: parseDeck(JSON.parse(raw), file) };
  } catch (e) {
    return { id, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadAllDecks(): Promise<DeckLoad[]> {
  const files = await listDeckFiles();
  return Promise.all(files.map((f) => loadDeck(path.basename(f, '.json'))));
}
