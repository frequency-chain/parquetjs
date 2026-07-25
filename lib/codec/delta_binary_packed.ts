import { Cursor, Options } from './types';

const DEFAULT_BLOCK_SIZE = 128;
const DEFAULT_MINI_BLOCK_COUNT = 4;
const INT32_MIN = -2147483648n;
const INT32_MAX = 2147483647n;
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

type IntegerValue = number | bigint;

function assertIntegerType(type: string) {
  if (type !== 'INT32' && type !== 'INT64') {
    throw new Error('unsupported type: ' + type);
  }
}

function normalizeIntegerValue(type: string, value: IntegerValue) {
  if (typeof value === 'number' && (!Number.isFinite(value) || !Number.isInteger(value))) {
    throw new Error(`${type} value must be a finite integer`);
  }

  const normalized = typeof value === 'bigint' ? value : BigInt(value);

  if (type === 'INT32' && (normalized < INT32_MIN || normalized > INT32_MAX)) {
    throw new Error('INT32 value out of range');
  }

  if (type === 'INT64' && (normalized < INT64_MIN || normalized > INT64_MAX)) {
    throw new Error('INT64 value out of range');
  }

  return normalized;
}

function bitWidthForType(type: string) {
  return type === 'INT32' ? 32n : 64n;
}

function toSignedInteger(value: bigint, bits: bigint) {
  const range = 1n << bits;
  const midpoint = 1n << (bits - 1n);
  const unsignedValue = ((value % range) + range) % range;

  return unsignedValue >= midpoint ? unsignedValue - range : unsignedValue;
}

function toOutputValue(type: string, value: bigint) {
  const normalized = toSignedInteger(value, bitWidthForType(type));

  if (type === 'INT64') {
    return normalized;
  }

  return Number(normalized);
}

function readUnsignedVarint(cursor: Cursor) {
  let result = 0n;
  let shift = 0n;

  while (cursor.offset < cursor.buffer.length) {
    const byte = BigInt(cursor.buffer[cursor.offset]);
    cursor.offset += 1;
    result |= (byte & 0x7fn) << shift;

    if ((byte & 0x80n) === 0n) {
      return result;
    }

    shift += 7n;
    if (shift > 70n) {
      throw new Error('invalid DELTA_BINARY_PACKED encoding');
    }
  }

  throw new Error('invalid DELTA_BINARY_PACKED encoding');
}

function writeUnsignedVarint(value: bigint) {
  if (value < 0n) {
    throw new Error('varint value must be unsigned');
  }

  const bytes = [];
  let remaining = value;

  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }

  bytes.push(Number(remaining));
  return Buffer.from(bytes);
}

function decodeZigZag(value: bigint) {
  return (value & 1n) === 0n ? value >> 1n : -((value + 1n) >> 1n);
}

function encodeZigZag(value: bigint) {
  return value >= 0n ? value << 1n : (-value << 1n) - 1n;
}

function readZigZagVarint(cursor: Cursor) {
  return decodeZigZag(readUnsignedVarint(cursor));
}

function writeZigZagVarint(value: bigint) {
  return writeUnsignedVarint(encodeZigZag(value));
}

function toSafeCount(value: bigint, name: string) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} is too large`);
  }

  return Number(value);
}

function validateBlockLayout(blockSize: number, miniBlockCount: number) {
  if (
    !Number.isInteger(blockSize) ||
    !Number.isInteger(miniBlockCount) ||
    blockSize <= 0 ||
    miniBlockCount <= 0 ||
    blockSize % miniBlockCount !== 0
  ) {
    throw new Error('invalid DELTA_BINARY_PACKED block layout');
  }
}

function bitLength(value: bigint) {
  if (value < 0n) {
    throw new Error('bit-packed values must be unsigned');
  }

  let bits = 0;
  let remaining = value;
  while (remaining > 0n) {
    bits += 1;
    remaining >>= 1n;
  }

  return bits;
}

function maxBitWidth(values: bigint[]) {
  let width = 0;
  for (const value of values) {
    width = Math.max(width, bitLength(value));
  }

  return width;
}

function bitMask(bitWidth: number) {
  return (1n << BigInt(bitWidth)) - 1n;
}

function packMiniBlock(values: bigint[], bitWidth: number) {
  const buf = Buffer.alloc(Math.ceil((values.length * bitWidth) / 8));

  if (bitWidth === 0) {
    return buf;
  }

  let accumulator = 0n;
  let bitsInAccumulator = 0;
  let byteOffset = 0;

  for (const value of values) {
    accumulator = (accumulator << BigInt(bitWidth)) | value;
    bitsInAccumulator += bitWidth;

    while (bitsInAccumulator >= 8) {
      bitsInAccumulator -= 8;
      buf[byteOffset] = Number((accumulator >> BigInt(bitsInAccumulator)) & 0xffn);
      byteOffset += 1;
      accumulator &= bitMask(bitsInAccumulator);
    }
  }

  if (bitsInAccumulator > 0) {
    buf[byteOffset] = Number((accumulator << BigInt(8 - bitsInAccumulator)) & 0xffn);
  }

  return buf;
}

function unpackMiniBlock(cursor: Cursor, count: number, bitWidth: number) {
  const byteLength = Math.ceil((count * bitWidth) / 8);
  if (cursor.offset + byteLength > cursor.buffer.length) {
    throw new Error('invalid DELTA_BINARY_PACKED encoding');
  }

  if (bitWidth === 0) {
    return new Array(count).fill(0n);
  }

  const values = [];
  let accumulator = 0n;
  let bitsInAccumulator = 0;
  let byteOffset = cursor.offset;

  for (let valueIndex = 0; valueIndex < count; valueIndex++) {
    while (bitsInAccumulator < bitWidth) {
      accumulator = (accumulator << 8n) | BigInt(cursor.buffer[byteOffset]);
      bitsInAccumulator += 8;
      byteOffset += 1;
    }

    bitsInAccumulator -= bitWidth;
    const value = (accumulator >> BigInt(bitsInAccumulator)) & bitMask(bitWidth);
    values.push(value);
    accumulator &= bitMask(bitsInAccumulator);
  }

  cursor.offset += byteLength;
  return values;
}

function getBlockLayout(opts?: Options) {
  const blockSize = opts?.deltaBinaryPackedBlockSize ?? opts?.blockSize ?? DEFAULT_BLOCK_SIZE;
  const miniBlockCount = opts?.deltaBinaryPackedMiniBlockCount ?? opts?.miniBlockCount ?? DEFAULT_MINI_BLOCK_COUNT;

  validateBlockLayout(blockSize, miniBlockCount);
  return { blockSize, miniBlockCount };
}

export const encodeValues = function (type: string, values: IntegerValue[], opts?: Options) {
  assertIntegerType(type);
  const { blockSize, miniBlockCount } = getBlockLayout(opts);

  const normalizedValues = values.map((value) => normalizeIntegerValue(type, value));
  const header = [
    writeUnsignedVarint(BigInt(blockSize)),
    writeUnsignedVarint(BigInt(miniBlockCount)),
    writeUnsignedVarint(BigInt(normalizedValues.length)),
  ];

  if (normalizedValues.length === 0) {
    return Buffer.concat(header);
  }

  header.push(writeZigZagVarint(normalizedValues[0]));

  const buffers = [...header];
  const valuesPerMiniBlock = blockSize / miniBlockCount;
  const typeBitWidth = bitWidthForType(type);
  const deltas = [];
  for (let i = 1; i < normalizedValues.length; i++) {
    deltas.push(toSignedInteger(normalizedValues[i] - normalizedValues[i - 1], typeBitWidth));
  }

  for (let offset = 0; offset < deltas.length; offset += blockSize) {
    const blockDeltas = deltas.slice(offset, offset + blockSize);
    const minDelta = blockDeltas.reduce((min, value) => (value < min ? value : min), blockDeltas[0]);
    const adjustedDeltas = blockDeltas.map((value) => value - minDelta);
    const bitWidths = Buffer.alloc(miniBlockCount);
    const miniBlocks = [];

    buffers.push(writeZigZagVarint(minDelta));

    for (let miniBlockIndex = 0; miniBlockIndex < miniBlockCount; miniBlockIndex++) {
      const start = miniBlockIndex * valuesPerMiniBlock;
      const miniBlockValues = adjustedDeltas.slice(start, start + valuesPerMiniBlock);
      while (miniBlockValues.length < valuesPerMiniBlock) {
        miniBlockValues.push(0n);
      }

      const bitWidth = maxBitWidth(miniBlockValues);
      bitWidths[miniBlockIndex] = bitWidth;
      miniBlocks.push(packMiniBlock(miniBlockValues, bitWidth));
    }

    buffers.push(bitWidths, ...miniBlocks);
  }

  return Buffer.concat(buffers);
};

export const decodeValues = function (type: string, cursor: Cursor, count: number, _opts?: Options) {
  assertIntegerType(type);

  const blockSize = toSafeCount(readUnsignedVarint(cursor), 'block size');
  const miniBlockCount = toSafeCount(readUnsignedVarint(cursor), 'mini block count');
  const totalValueCount = toSafeCount(readUnsignedVarint(cursor), 'value count');

  validateBlockLayout(blockSize, miniBlockCount);

  if (totalValueCount !== count) {
    throw new Error(`DELTA_BINARY_PACKED value count ${totalValueCount} does not match requested count ${count}`);
  }

  if (totalValueCount === 0) {
    return [];
  }

  const values = [];
  const valuesPerMiniBlock = blockSize / miniBlockCount;
  const typeBitWidth = bitWidthForType(type);
  let previousValue = readZigZagVarint(cursor);
  values.push(toOutputValue(type, previousValue));

  while (values.length < totalValueCount) {
    const minDelta = readZigZagVarint(cursor);
    if (cursor.offset + miniBlockCount > cursor.buffer.length) {
      throw new Error('invalid DELTA_BINARY_PACKED encoding');
    }

    const bitWidths = cursor.buffer.subarray(cursor.offset, cursor.offset + miniBlockCount);
    cursor.offset += miniBlockCount;

    for (const bitWidth of bitWidths) {
      if (values.length === totalValueCount) {
        break;
      }

      const adjustedDeltas = unpackMiniBlock(cursor, valuesPerMiniBlock, bitWidth);
      for (const adjustedDelta of adjustedDeltas) {
        if (values.length === totalValueCount) {
          break;
        }

        previousValue = toSignedInteger(previousValue + minDelta + adjustedDelta, typeBitWidth);
        values.push(toOutputValue(type, previousValue));
      }
    }
  }

  return values;
};
