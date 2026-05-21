'use strict';
const chai = require('chai');
const assert = chai.assert;
const parquetCodecDeltaBinaryPacked = require('../lib/codec/delta_binary_packed');

describe('ParquetCodec::DELTA_BINARY_PACKED', function () {
  it('should decode constant delta values', function () {
    const vals = parquetCodecDeltaBinaryPacked.decodeValues(
      'INT32',
      {
        buffer: Buffer.from([0x80, 0x01, 0x04, 0x05, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00]),
        offset: 0,
      },
      5,
      {}
    );

    assert.deepEqual(vals, [10, 11, 12, 13, 14]);
  });

  it('should decode bit-packed mini block values', function () {
    const vals = parquetCodecDeltaBinaryPacked.decodeValues(
      'INT32',
      {
        buffer: Buffer.from([
          0x80, 0x01, 0x04, 0x05, 0x0a, 0x04, 0x02, 0x00, 0x00, 0x00, 0x1b, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00,
        ]),
        offset: 0,
      },
      5,
      {}
    );

    assert.deepEqual(vals, [5, 7, 10, 14, 19]);
  });

  it('should encode and decode INT32 values', function () {
    const expected = [1, 2, 4, 7, 11, 16, 22, 29, 37, 46];
    const buf = parquetCodecDeltaBinaryPacked.encodeValues('INT32', expected, {});
    const vals = parquetCodecDeltaBinaryPacked.decodeValues('INT32', { buffer: buf, offset: 0 }, expected.length, {});

    assert.deepEqual(vals, expected);
  });

  it('should encode and decode INT64 values', function () {
    const expected = [1n, 4n, 10n, 19n, 31n];
    const buf = parquetCodecDeltaBinaryPacked.encodeValues('INT64', expected, {});
    const vals = parquetCodecDeltaBinaryPacked.decodeValues('INT64', { buffer: buf, offset: 0 }, expected.length, {});

    assert.deepEqual(vals, expected);
  });
});
