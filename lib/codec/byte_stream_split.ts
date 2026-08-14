import { Cursor, Options } from './types';
import * as PLAIN from './plain';

type ValidValueTypes =
  | 'INT32'
  | 'INT64'
  | 'FLOAT'
  | 'DOUBLE'
  | 'FIXED_LEN_BYTE_ARRAY';

function getTypeByteWidth(type: ValidValueTypes | string, opts: Options): number {
  switch (type) {
    case 'INT32':
    case 'FLOAT':
      return 4;
    case 'INT64':
    case 'DOUBLE':
      return 8;
    case 'FIXED_LEN_BYTE_ARRAY': {
      const typeLength = opts.typeLength ?? opts.column?.typeLength;
      if (typeLength === undefined) {
        throw new Error('missing option: typeLength (required for FIXED_LEN_BYTE_ARRAY)');
      }
      return typeLength;
    }
    default:
      throw new Error('unsupported type for BYTE_STREAM_SPLIT: ' + type);
  }
}

export const encodeValues = function (type: ValidValueTypes | string, values: unknown[], opts: Options) {
  const K = getTypeByteWidth(type, opts);
  const N = values.length;
  const plainBuffer = PLAIN.encodeValues(type, values, opts);

  if (plainBuffer.length !== K * N) {
    throw new Error(`Unexpected plain buffer length: expected ${K * N}, got ${plainBuffer.length}`);
  }

  const encoded = Buffer.alloc(K * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < K; j++) {
      // j-th byte of i-th element is at plainBuffer[i * K + j]
      // It should go to encoded[j * N + i]
      encoded[j * N + i] = plainBuffer[i * K + j];
    }
  }

  return encoded;
};

export const decodeValues = function (type: ValidValueTypes | string, cursor: Cursor, count: number, opts: Options) {
  const K = getTypeByteWidth(type, opts);
  const N = count;
  const totalBytes = K * N;

  if (cursor.offset + totalBytes > cursor.buffer.length) {
      throw new Error('insufficient bytes for BYTE_STREAM_SPLIT');
  }

  const buffer = cursor.buffer.subarray(cursor.offset, cursor.offset + totalBytes);
  cursor.offset += totalBytes;

  const decoded = Buffer.alloc(totalBytes);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < K; j++) {
      // j-th byte of i-th element is at buffer[j * N + i]
      decoded[i * K + j] = buffer[j * N + i];
    }
  }

  // Now use PLAIN decoder on the reconstructed bytes
  const newCursor: Cursor = {
    buffer: decoded,
    offset: 0,
    size: totalBytes
  };
  return PLAIN.decodeValues(type, newCursor, count, opts);
};
