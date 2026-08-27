// NOTICE: This is the NodeJS implementation.
// The browser implementation is ./browser/compression.ts
import zlib from 'zlib';
import { promisify } from 'util';
import snappy from 'snappyjs';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

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
  },
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

function deflate_gzip(value: ArrayBuffer | Buffer | string) {
  return gzipAsync(value);
}

function deflate_snappy(value: ArrayBuffer | Buffer | Uint8Array) {
  const compressedValue = snappy.compress(value);
  return buffer_from_result(compressedValue);
}

async function deflate_brotli(value: Uint8Array) {
  return zlib.brotliCompressSync(value);
}
async function deflate_zstd(value: Uint8Array) {
  return zlib.zstdCompressSync(value);
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

async function inflate_gzip(value: Buffer | ArrayBuffer | string) {
  return gunzipAsync(value);
}

function inflate_snappy(value: ArrayBuffer | Buffer | Uint8Array) {
  const uncompressedValue = snappy.uncompress(value);
  return buffer_from_result(uncompressedValue);
}

async function inflate_brotli(value: Uint8Array) {
  return zlib.brotliDecompressSync(value);
}

async function inflate_zstd(value: Uint8Array) {
  return zlib.zstdDecompressSync(value);
}

function buffer_from_result(result: ArrayBuffer | Buffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(result)) {
    return result;
  } else {
    return Buffer.from(new Uint8Array(result));
  }
}
