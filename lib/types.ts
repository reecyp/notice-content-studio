// Mirrors docs/deck-schema.md (v2). Keep the two in step.

export type Block =
  | { kind: 'paragraph'; text: string; hug?: boolean }
  | { kind: 'lead'; text: string; hug?: boolean }
  | { kind: 'lines'; lines: string[]; hug?: boolean }
  | { kind: 'bullets'; items: string[]; hug?: boolean };

export type Point = {
  number?: number;
  title?: string;
  titleSub?: string;
  body: Block[];
};

export type Layout = {
  scale?: number;
  lineHeight?: number;
  bottom?: number;
  emphasis?: 'title' | 'body' | 'none';
};

export type Tile =
  | { role: 'hook'; lines: string[]; layout?: Layout }
  | { role: 'point'; points: Point[]; layout?: Layout }
  | { role: 'closer'; title?: string; titleSub?: string; body: Block[]; layout?: Layout }
  | { role: 'endcard'; headline?: string; body?: string; handle?: string; layout?: Layout };

export type Deck = {
  schemaVersion: 2;
  id: string;
  iteration: number;
  format: 'paper-note';
  post?: { description?: string; hashtags?: string[] };
  tiles: Tile[];
};

export const BLOCK_KINDS = ['paragraph', 'lead', 'lines', 'bullets'] as const;
export const TILE_ROLES = ['hook', 'point', 'closer', 'endcard'] as const;
