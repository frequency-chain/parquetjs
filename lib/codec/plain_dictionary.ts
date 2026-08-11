import * as rle from './rle';
import { Cursor, Options } from './types';

export const decodeValues = function (type: string, cursor: Cursor, count: number, opts: Options) {
  const bitWidth = cursor.buffer.subarray(cursor.offset, cursor.offset + 1).readInt8(0);
  cursor.offset += 1;
  return rle.decodeValues(type, cursor, count, Object.assign({}, opts, { disableEnvelope: true, bitWidth }));
};

export const encodeValues = function () {
  throw new Error('PLAIN_DICTIONARY encoding not supported');
};
