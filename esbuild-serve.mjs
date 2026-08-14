/**
 * Use this to serve the parquetjs bundle at http://localhost:8000/main.js
 * It attaches the parquet.js exports to a "parquetjs" global variable.
 * See the example server for how to use it.
 */
import { compressionBrowserPlugin } from './esbuild-plugins.mjs';
import esbuild from 'esbuild';

// esbuild has TypeScript support by default. It will use .tsconfig
esbuild
  .context({
    entryPoints: ['parquet.ts'],
    outfile: 'main.js',
    define: { 'process.env.NODE_DEBUG': 'false', 'process.env.NODE_ENV': '"production"', global: 'window' },
    platform: 'browser',
    loader: {
      '.wasm': 'file',
    },
    plugins: [compressionBrowserPlugin],
    sourcemap: 'external',
    bundle: true,
    minify: false,
    globalName: 'parquetjs',
    inject: ['./esbuild-shims.mjs'],
  })
  .then((context) => {
    context
      .serve({
        servedir: './',
      })
      .then((server) => {
        console.log('serving parquetjs', server);
      });
  });
