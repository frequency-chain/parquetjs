import INT53 from 'int53';
import { Cursor, Options } from './types';

function encodeValues_BOOLEAN(values: boolean[]) {
  const buf = Buffer.alloc(Math.ceil(values.length / 8));
  buf.fill(0);

  for (let i = 0; i < values.length; ++i) {
    if (values[i]) {
      buf[Math.floor(i / 8)] |= 1 << i % 8;
    }
  }

  return buf;
}

function decodeValues_BOOLEAN(cursor: Cursor, count: number) {
  const values = [];

  for (let i = 0; i < count; ++i) {
    const b = cursor.buffer[cursor.offset + Math.floor(i / 8)];
    values.push((b & (1 << i % 8)) > 0);
  }

  cursor.offset += Math.ceil(count / 8);
  return values;
}

function encodeValues_INT32(values: number[], opts: Options) {
  const isDecimal = opts?.originalType === 'DECIMAL' || opts?.column?.originalType === 'DECIMAL';
  const scale = opts?.scale || 0;
  const buf = Buffer.alloc(4 * values.length);
  for (let i = 0; i < values.length; i++) {
    if (isDecimal) {
      buf.writeInt32LE(values[i] * Math.pow(10, scale), i * 4);
    } else {
      buf.writeInt32LE(values[i], i * 4);
    }
  }

  return buf;
}

function decodeValues_INT32(cursor: Cursor, count: number, opts: Options) {
  let values = [];
  const name = opts.name || opts.column?.name || undefined;
  try {
    if (opts.originalType === 'DECIMAL') {
      values = decodeValues_DECIMAL(cursor, count, opts, 4);
    } else {
      for (let i = 0; i < count; ++i) {
        values.push(cursor.buffer.readInt32LE(cursor.offset));
        cursor.offset += 4;
      }
    }
  } catch (e) {
    console.log(`Error thrown for column: ${name}`);
    throw e;
  }

  return values;
}

function encodeValues_INT64(values: number[], opts: Options) {
  const isDecimal = opts?.originalType === 'DECIMAL' || opts?.column?.originalType === 'DECIMAL';
  const scale = opts?.scale || 0;
  const buf = Buffer.alloc(8 * values.length);
  for (let i = 0; i < values.length; i++) {
    if (isDecimal) {
      buf.writeBigInt64LE(BigInt(Math.floor(values[i] * Math.pow(10, scale))), i * 8);
    } else {
      buf.writeBigInt64LE(BigInt(values[i]), i * 8);
    }
  }

  return buf;
}

function decodeValues_INT64(cursor: Cursor, count: number, opts: Options) {
  let values = [];
  const name = opts.name || opts.column?.name || undefined;
  try {
    if (opts.originalType === 'DECIMAL' || opts.column?.originalType === 'DECIMAL') {
      const columnOptions: any = opts.column?.originalType ? opts.column : opts;
      values = decodeValues_DECIMAL(cursor, count, columnOptions, 8);
    } else {
      for (let i = 0; i < count; ++i) {
        values.push(cursor.buffer.readBigInt64LE(cursor.offset));
        cursor.offset += 8;
      }
    }
  } catch (e) {
    console.log(`Error thrown for column: ${name}`);
    throw e;
  }

  return values;
}

function decodeValues_DECIMAL(cursor: Cursor, count: number, opts: Options, byteWidth: 4 | 8) {
  const precision = opts.precision;
  // Default scale to 0 per spec
  const scale = opts.scale || 0;

  const name = opts.name || undefined;
  if (!precision) {
    throw new Error(`missing option: precision (required for DECIMAL) for column: ${name}`);
  }

  const values = [];

  const bufferFunction = (offset: number) =>
    byteWidth === 8 ? cursor.buffer.readBigInt64LE(offset) : cursor.buffer.readInt32LE(offset);
  for (let i = 0; i < count; ++i) {
    const bufferSize = cursor.size || 0;
    if (bufferSize === 0 || cursor.offset < bufferSize) {
      const fullValue = bufferFunction(cursor.offset);
      const valueWithDecimalApplied = Number(fullValue) / Math.pow(10, scale);
      values.push(valueWithDecimalApplied);
      cursor.offset += byteWidth;
    }
  }

  return values;
}

function encodeValues_INT96(values: number[]) {
  const buf = Buffer.alloc(12 * values.length);

  for (let i = 0; i < values.length; i++) {
    if (values[i] >= 0) {
      INT53.writeInt64LE(values[i], buf, i * 12);
      buf.writeUInt32LE(0, i * 12 + 8); // truncate to 64 actual precision
    } else {
      INT53.writeInt64LE(~-values[i] + 1, buf, i * 12);
      buf.writeUInt32LE(0xffffffff, i * 12 + 8); // truncate to 64 actual precision
    }
  }

  return buf;
}

function decodeValues_INT96(cursor: Cursor, count: number, opts?: Options) {
  const values = [];
  // Default to false for backward compatibility
  const treatAsTimestamp = opts?.treatInt96AsTimestamp === true;

  for (let i = 0; i < count; ++i) {
    // when treatAsTimestamp is true, low is nanoseconds since midnight
    const low = INT53.readInt64LE(cursor.buffer, cursor.offset);
    // when treatAsTimestamp is true, high is Julian day
    const high = cursor.buffer.readUInt32LE(cursor.offset + 8);

    if (treatAsTimestamp) {
      // Convert Julian day and nanoseconds to a timestamp
      values.push(convertInt96ToTimestamp(high, low));
    } else {
      // For non-timestamp INT96 values, maintain existing behavior
      if (high === 0xffffffff) {
        values.push(~-low + 1); // negative value
      } else {
        values.push(low); // positive value
      }
    }

    cursor.offset += 12;
  }

  return values;
}

/**
 * Convert INT96 to timestamp
 * In the Parquet format, INT96 timestamps are stored as:
 * - The first 8 bytes (low) represent nanoseconds within the day
 * - The last 4 bytes (high) represent the Julian day
 *
 * @param julianDay Julian day number
 * @param nanosSinceMidnight Nanoseconds since midnight
 * @returns JavaScript Date object (UTC)
 */
function convertInt96ToTimestamp(julianDay: number, nanosSinceMidnight: number | bigint): Date {
  // Julian day 2440588 corresponds to 1970-01-01 (Unix epoch)
  const daysSinceEpoch = julianDay - 2440588;

  // Convert days to milliseconds (86,400,000 ms per day)
  const millisSinceEpoch = daysSinceEpoch * 86400000;

  // Convert nanoseconds to milliseconds
  const nanosInMillis = Number(BigInt(nanosSinceMidnight) / 1000000n);

  // Create a UTC Date
  return new Date(millisSinceEpoch + nanosInMillis);
}

function encodeValues_FLOAT(values: number[]) {
  const buf = Buffer.alloc(4 * values.length);
  for (let i = 0; i < values.length; i++) {
    buf.writeFloatLE(values[i], i * 4);
  }

  return buf;
}

function decodeValues_FLOAT(cursor: Cursor, count: number) {
  const values = [];

  for (let i = 0; i < count; ++i) {
    values.push(cursor.buffer.readFloatLE(cursor.offset));
    cursor.offset += 4;
  }

  return values;
}

function encodeValues_DOUBLE(values: number[]) {
  const buf = Buffer.alloc(8 * values.length);
  for (let i = 0; i < values.length; i++) {
    buf.writeDoubleLE(values[i], i * 8);
  }

  return buf;
}

function decodeValues_DOUBLE(cursor: Cursor, count: number) {
  const values = [];

  for (let i = 0; i < count; ++i) {
    values.push(cursor.buffer.readDoubleLE(cursor.offset));
    cursor.offset += 8;
  }

  return values;
}

function encodeValues_BYTE_ARRAY(values: Uint8Array[]) {
  let buf_len = 0;
  const returnedValues: Buffer[] = [];
  for (let i = 0; i < values.length; i++) {
    returnedValues[i] = Buffer.from(values[i]);
    buf_len += 4 + returnedValues[i].length;
  }

  const buf = Buffer.alloc(buf_len);
  let buf_pos = 0;
  for (let i = 0; i < returnedValues.length; i++) {
    buf.writeUInt32LE(returnedValues[i].length, buf_pos);
    returnedValues[i].copy(buf, buf_pos + 4);
    buf_pos += 4 + returnedValues[i].length;
  }

  return buf;
}

function decodeValues_BYTE_ARRAY(cursor: Cursor, count: number) {
  const values = [];

  for (let i = 0; i < count; ++i) {
    const len = cursor.buffer.readUInt32LE(cursor.offset);
    cursor.offset += 4;
    values.push(cursor.buffer.subarray(cursor.offset, cursor.offset + len));
    cursor.offset += len;
  }

  return values;
}

function encodeValues_FIXED_LEN_BYTE_ARRAY(values: Uint8Array[], opts: Options) {
  if (!opts.typeLength) {
    throw new Error('missing option: typeLength (required for FIXED_LEN_BYTE_ARRAY)');
  }

  const returnedValues: Buffer[] = [];
  for (let i = 0; i < values.length; i++) {
    returnedValues[i] = Buffer.from(values[i]);

    if (returnedValues[i].length !== opts.typeLength) {
      throw new Error('invalid value for FIXED_LEN_BYTE_ARRAY: ' + returnedValues[i]);
    }
  }

  return Buffer.concat(returnedValues);
}

function decodeValues_FIXED_LEN_BYTE_ARRAY(cursor: Cursor, count: number, opts: Options) {
  const values = [];
  const typeLength = opts.typeLength ?? (opts.column ? opts.column.typeLength : undefined);
  if (!typeLength) {
    throw new Error('missing option: typeLength (required for FIXED_LEN_BYTE_ARRAY)');
  }

  for (let i = 0; i < count; ++i) {
    values.push(cursor.buffer.subarray(cursor.offset, cursor.offset + typeLength));
    cursor.offset += typeLength;
  }

  return values;
}

type ValidValueTypes =
  | 'BOOLEAN'
  | 'INT32'
  | 'INT64'
  | 'INT96'
  | 'FLOAT'
  | 'DOUBLE'
  | 'BYTE_ARRAY'
  | 'FIXED_LEN_BYTE_ARRAY';

export const encodeValues = function (type: ValidValueTypes | string, values: unknown[], opts: Options) {
  switch (type) {
    case 'BOOLEAN':
      return encodeValues_BOOLEAN(values as boolean[]);

    case 'INT32':
      return encodeValues_INT32(values as number[], opts);

    case 'INT64':
      return encodeValues_INT64(values as number[], opts);

    case 'INT96':
      return encodeValues_INT96(values as number[]);

    case 'FLOAT':
      return encodeValues_FLOAT(values as number[]);

    case 'DOUBLE':
      return encodeValues_DOUBLE(values as number[]);

    case 'BYTE_ARRAY':
      return encodeValues_BYTE_ARRAY(values as Uint8Array[]);

    case 'FIXED_LEN_BYTE_ARRAY':
      return encodeValues_FIXED_LEN_BYTE_ARRAY(values as Uint8Array[], opts);

    default:
      throw new Error('unsupported type: ' + type);
  }
};

export const decodeValues = function (type: ValidValueTypes | string, cursor: Cursor, count: number, opts: Options) {
  switch (type) {
    case 'BOOLEAN':
      return decodeValues_BOOLEAN(cursor, count);

    case 'INT32':
      return decodeValues_INT32(cursor, count, opts);

    case 'INT64':
      return decodeValues_INT64(cursor, count, opts);

    case 'INT96':
      return decodeValues_INT96(cursor, count, opts);

    case 'FLOAT':
      return decodeValues_FLOAT(cursor, count);

    case 'DOUBLE':
      return decodeValues_DOUBLE(cursor, count);

    case 'BYTE_ARRAY':
      return decodeValues_BYTE_ARRAY(cursor, count);

    case 'FIXED_LEN_BYTE_ARRAY':
      return decodeValues_FIXED_LEN_BYTE_ARRAY(cursor, count, opts);

    default:
      throw new Error('unsupported type: ' + type);
  }
};
