/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // A verification build can be pointed at its own directory so it never
  // clobbers the chunks a running `next dev` is holding open.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // @napi-rs/canvas ships a platform-specific .node binary. Webpack has no
  // loader for it and tries to parse it as source, so it has to stay external
  // and be required at runtime.
  serverExternalPackages: ['@napi-rs/canvas'],
  // public/ is served by the CDN and is not otherwise part of a function's
  // bundle, but the tile renderer reads the face files and the paper off disk
  // at request time. Trace them in explicitly or the deployed route falls back
  // to a substitute font and lays tiles out at the wrong widths.
  outputFileTracingIncludes: {
    '/api/tile/**': ['./public/fonts/*.ttf', './public/paper.png'],
  },
};
