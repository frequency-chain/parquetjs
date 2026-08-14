// NOTICE: This is NOT tested by the normal unit tests as this is the browser version
// Needs to be tested manually for now by:
// 1. Load up the example server
// 2. examples/service/README.md
// 3. Test the files
'use strict';
import snappy from 'snappyjs';
import * as brotli from './brotli.js';
import { inflate as pako_zstd_inflate, deflate as pako_zstd_deflate } from 'pako';

type PARQUET_COMPRESSION_METHODS = Record<
  string,
  {
    deflate: (value: any) => Buffer | Promise<Buffer>;
    inflate: (value: any) => Buffer | Promise<Buffer>;
  }
>;
// LZO compression is disabled. See: https://github.com/LibertyDSNP/parquetjs/issues/18
export const PARQUET_COMPRESSION_METHODS: PARQUET_COMPRESSION_METHODS = {
  UNCOMPRESSED: {
    deflate: deflate_identity,
    inflate: inflate_identity,
  },
  GZIP: {
    deflate: deflate_gzip,
    inflate: inflate_gzip,
  },
  SNAPPY: {
    deflate: deflate_snappy,
    inflate: inflate_snappy,
  },
  BROTLI: {
    deflate: deflate_brotli,
    inflate: inflate_brotli,
  },
  ZSTD: {
    deflate: deflate_zstd,
    inflate: inflate_zstd,
  }
};

/**
 * Deflate a value using compression method `method`
 */
export async function deflate(method: string, value: unknown): Promise<Buffer> {
  if (!(method in PARQUET_COMPRESSION_METHODS)) {
    throw new Error('invalid compression method: ' + method);
  }

  return PARQUET_COMPRESSION_METHODS[method].deflate(value);
}

function deflate_identity(value: ArrayBuffer | Buffer | Uint8Array) {
  return buffer_from_result(value);
}

async function deflate_gzip(value: ArrayBuffer | string) {
  const cs = new CompressionStream('gzip');
  const pipedCs = new Response(value).body?.pipeThrough(cs);
  return buffer_from_result(await new Response(pipedCs).arrayBuffer());
}

function deflate_snappy(value: ArrayBuffer | Buffer | Uint8Array) {
  const compressedValue = snappy.compress(value);
  return buffer_from_result(compressedValue);
}

async function deflate_brotli(value: Uint8Array) {
  return buffer_from_result(await brotli.compress(value));
}

async function deflate_zstd(value: Uint8Array) {
  return buffer_from_result(pako_zstd_deflate(value));
}

/**
 * Inflate a value using compression method `method`
 */
export async function inflate(method: string, value: unknown): Promise<Buffer> {
  if (!(method in PARQUET_COMPRESSION_METHODS)) {
    throw new Error('invalid compression method: ' + method);
  }

  return await PARQUET_COMPRESSION_METHODS[method].inflate(value);
}

async function inflate_identity(value: ArrayBuffer | Buffer | Uint8Array): Promise<Buffer> {
  return buffer_from_result(value);
}

async function inflate_gzip(value: ArrayBuffer | string) {
  const ds = new DecompressionStream('gzip');
  const pipedDs = new Response(value).body?.pipeThrough(ds);
  return buffer_from_result(await new Response(pipedDs).arrayBuffer());
}

function inflate_snappy(value: ArrayBuffer | Buffer | Uint8Array) {
  const uncompressedValue = snappy.uncompress(value);
  return buffer_from_result(uncompressedValue);
}

async function inflate_brotli(value: Uint8Array) {
  return buffer_from_result(await brotli.inflate(value));
}

async function inflate_zstd(value: Uint8Array) {
  return buffer_from_result(pako_zstd_inflate(value));
}

function buffer_from_result(result: ArrayBuffer | Buffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(result)) {
    return result;
  } else {
    return Buffer.from(new Uint8Array(result));
  }
}
