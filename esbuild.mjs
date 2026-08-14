import esbuild from 'esbuild';
import { compressionBrowserPlugin } from './esbuild-plugins.mjs';
// esbuild has TypeScript support by default
const baseConfig = {
  bundle: true,
  entryPoints: ['parquet.ts'],
  define: {
    'process.env.NODE_DEBUG': 'false',
    'process.env.NODE_ENV': '"production"',
    global: 'window',
  },
  inject: ['./esbuild-shims.mjs'],
  minify: true,
  mainFields: ['browser', 'module', 'main'],
  platform: 'browser', // default
  loader: {
    '.wasm': 'file',
  },
  plugins: [compressionBrowserPlugin],
  target: 'es2020', // default
};
// configuration for generating test code in browser
const testConfig = {
  bundle: true,
  entryPoints: ['test/browser/main.ts'],
  define: {
    'process.env.NODE_DEBUG': 'false',
    'process.env.NODE_ENV': '"production"',
    global: 'window',
  },
  inject: ['./esbuild-shims.mjs'],
  minify: false,
  mainFields: ['browser', 'module', 'main'],
  platform: 'browser', // default
  loader: {
    '.wasm': 'file',
  },
  plugins: [compressionBrowserPlugin],
  target: 'es2020', // default
};
const targets = [
  {
    ...baseConfig,
    globalName: 'parquetjs',
    outdir: './dist/browser',
  },
  {
    ...baseConfig,
    format: 'esm',
    outfile: 'dist/browser/parquet.esm.js',
  },
  {
    ...baseConfig,
    format: 'cjs',
    outfile: 'dist/browser/parquet.cjs.js',
  },
];

// Browser test code below is only in ESM
const testTargets = [
  {
    ...testConfig,
    format: 'esm',
    mainFields: ['module', 'main'],
    outfile: 'test/browser/main.js',
  },
];

Promise.all(targets.map(esbuild.build))
  .then((results) => {
    if (results.reduce((m, r) => m && !r.warnings.length, true)) {
      console.log('built dist targets with no errors or warnings');
    }
  })
  .then(() => {
    return Promise.all(testTargets.map(esbuild.build));
  })
  .then((results) => {
    if (results.reduce((m, r) => m && !r.warnings.length, true)) {
      console.log('built test targets with no errors or warnings');
    }
  })
  .catch((e) => {
    console.error('Finished with errors: ', e.toString());
    process.exit(1);
  });
