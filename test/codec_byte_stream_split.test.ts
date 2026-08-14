import { expect } from 'chai';
import * as BYTE_STREAM_SPLIT from '../lib/codec/byte_stream_split';

describe('BYTE_STREAM_SPLIT codec', function() {
  it('should encode and decode INT32', function() {
    const values = [1, 2, 3];
    const opts = {};
    const encoded = BYTE_STREAM_SPLIT.encodeValues('INT32', values, opts);
    const cursor = { buffer: encoded, offset: 0 };
    const decoded = BYTE_STREAM_SPLIT.decodeValues('INT32', cursor, values.length, opts);
    expect(decoded).to.deep.equal(values);
  });

  it('should encode and decode INT64', function() {
    const values = [BigInt(1), BigInt(2), BigInt(3)];
    const opts = {};
    const encoded = BYTE_STREAM_SPLIT.encodeValues('INT64', values, opts);
    const cursor = { buffer: encoded, offset: 0 };
    const decoded = BYTE_STREAM_SPLIT.decodeValues('INT64', cursor, values.length, opts);
    expect(decoded).to.deep.equal(values);
  });

  it('should encode and decode FLOAT', function() {
    const values = [1.5, 2.5, 3.5];
    const opts = {};
    const encoded = BYTE_STREAM_SPLIT.encodeValues('FLOAT', values, opts);
    const cursor = { buffer: encoded, offset: 0 };
    const decoded = BYTE_STREAM_SPLIT.decodeValues('FLOAT', cursor, values.length, opts);
    expect(decoded).to.deep.equal(values);
  });

  it('should encode and decode DOUBLE', function() {
    const values = [1.5, 2.5, 3.5];
    const opts = {};
    const encoded = BYTE_STREAM_SPLIT.encodeValues('DOUBLE', values, opts);
    const cursor = { buffer: encoded, offset: 0 };
    const decoded = BYTE_STREAM_SPLIT.decodeValues('DOUBLE', cursor, values.length, opts);
    expect(decoded).to.deep.equal(values);
  });

  it('should encode and decode FIXED_LEN_BYTE_ARRAY', function() {
    const values = [
      Buffer.from('abcd'),
      Buffer.from('efgh'),
      Buffer.from('ijkl')
    ];
    const opts = { typeLength: 4 };
    const encoded = BYTE_STREAM_SPLIT.encodeValues('FIXED_LEN_BYTE_ARRAY', values, opts);
    const cursor = { buffer: encoded, offset: 0 };
    const decoded = BYTE_STREAM_SPLIT.decodeValues('FIXED_LEN_BYTE_ARRAY', cursor, values.length, opts);
    // PLAIN decoder for FIXED_LEN_BYTE_ARRAY returns subarray of the buffer
    // which are Uint8Array in modern Node, but we compare with Buffers
    decoded.forEach((v, i) => {
        expect(Buffer.from(v)).to.deep.equal(values[i]);
    });
  });

  it('should match the example from the issue description', function() {
    // Original data: AA BB CC DD, 00 11 22 33, A3 B4 C5 D6 (three 32-bit floats)
    // Encoded: AA 00 A3 BB 11 B4 CC 22 C5 DD 33 D6
    const encoded = Buffer.from([
        0xAA, 0x00, 0xA3,
        0xBB, 0x11, 0xB4,
        0xCC, 0x22, 0xC5,
        0xDD, 0x33, 0xD6
    ]);
    const cursor = { buffer: encoded, offset: 0 };
    const count = 3;
    const decoded = BYTE_STREAM_SPLIT.decodeValues('FLOAT', cursor, count, {});

    const expectedValues = [
        Buffer.from([0xAA, 0xBB, 0xCC, 0xDD]).readFloatLE(0),
        Buffer.from([0x00, 0x11, 0x22, 0x33]).readFloatLE(0),
        Buffer.from([0xA3, 0xB4, 0xC5, 0xD6]).readFloatLE(0)
    ];
    expect(decoded).to.deep.equal(expectedValues);
  });
});
