/**
 * Neon's HTTP endpoint, served from this process by PGlite.
 *
 * `@neondatabase/serverless` talks SQL over fetch rather than over a socket,
 * which is the one thing that makes lib/db.ts testable without a cloud
 * database: stand in for that endpoint and the real SQL, the real transactions
 * and the real row mapping all run against a real Postgres, in process.
 *
 * Shared by check-ledger.mjs, which exercises lib/db.ts directly, and
 * check-queue.mjs, which drives the batch route on top of it.
 */

/** PGlite hands back JS values; the driver's parsers only accept Postgres text. */
const text = (v) =>
  v === null || v === undefined ? null
  : v instanceof Date ? v.toISOString().replace('T', ' ').replace('Z', '+00')
  : typeof v === 'object' ? JSON.stringify(v)
  : String(v);

/**
 * Point global fetch at `pg` for Neon's host, and hand anything else to
 * `passthrough` — which is how check-queue.mjs stands in for TikTok at the
 * same time.
 */
export function serveNeon(pg, passthrough) {
  const run = async ({ query, params }) => {
    const r = await pg.query(query, params ?? [], { rowMode: 'array' });
    return {
      fields: (r.fields ?? []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rows: (r.rows ?? []).map((row) => row.map(text)),
      rowCount: r.affectedRows ?? r.rows?.length ?? 0,
      command: query.trim().split(/\s+/)[0].toUpperCase(),
    };
  };

  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('neon.tech')) {
      if (passthrough) return passthrough(url, init);
      throw new Error(`unexpected fetch to ${url}`);
    }

    const body = JSON.parse(init.body);
    let payload;
    if (body.queries) {
      await pg.exec('begin');
      try {
        const results = [];
        for (const q of body.queries) results.push(await run(q));
        await pg.exec('commit');
        payload = { results };
      } catch (e) {
        await pg.exec('rollback');
        throw e;
      }
    } else {
      payload = await run(body);
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

/** The connection string the shim answers to. Any Neon host would do. */
export const SHIM_URL = 'postgresql://check:check@ep-check.us-east-2.aws.neon.tech/check';
