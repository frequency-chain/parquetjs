'use strict';
const chai = require('chai');
const assert = chai.assert;
const parquetCodecDeltaBinaryPacked = require('../lib/codec/delta_binary_packed');

function roundTrip(type, expected, opts = {}) {
  const buf = parquetCodecDeltaBinaryPacked.encodeValues(type, expected, opts);
  return parquetCodecDeltaBinaryPacked.decodeValues(type, { buffer: buf, offset: 0 }, expected.length, opts);
}

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
          0x80, 0x01, 0x04, 0x05, 0x0a, 0x04, 0x02, 0x00, 0x00, 0x00, 0x1b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
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
    const vals = roundTrip('INT32', expected);

    assert.deepEqual(vals, expected);
  });

  it('should encode and decode INT64 values', function () {
    const expected = [1n, 4n, 10n, 19n, 31n];
    const vals = roundTrip('INT64', expected);

    assert.deepEqual(vals, expected);
  });

  it('should encode and decode negative values and deltas', function () {
    const expected = [-10, -7, -8, -20, 0, -1];
    const vals = roundTrip('INT32', expected);

    assert.deepEqual(vals, expected);
  });

  it('should encode and decode empty input', function () {
    const vals = roundTrip('INT32', []);

    assert.deepEqual(vals, []);
  });

  it('should encode and decode a single value', function () {
    const vals = roundTrip('INT32', [-42]);

    assert.deepEqual(vals, [-42]);
  });

  it('should encode and decode custom block layouts', function () {
    const expected = [3, 8, 13, 21, 34, 55, 54, 53, 52, 80];
    const opts = { deltaBinaryPackedBlockSize: 8, deltaBinaryPackedMiniBlockCount: 2 };
    const vals = roundTrip('INT32', expected, opts);

    assert.deepEqual(vals, expected);
  });

  it('should reject invalid custom block layouts', function () {
    assert.throws(
      () =>
        parquetCodecDeltaBinaryPacked.encodeValues('INT32', [1, 2, 3], {
          deltaBinaryPackedBlockSize: 7,
          deltaBinaryPackedMiniBlockCount: 2,
        }),
      /invalid DELTA_BINARY_PACKED block layout/
    );

    assert.throws(
      () =>
        parquetCodecDeltaBinaryPacked.encodeValues('INT32', [1, 2, 3], {
          deltaBinaryPackedBlockSize: 0,
          deltaBinaryPackedMiniBlockCount: 2,
        }),
      /invalid DELTA_BINARY_PACKED block layout/
    );
  });

  it('should reject non-integer numeric values', function () {
    assert.throws(
      () => parquetCodecDeltaBinaryPacked.encodeValues('INT32', [1, 1.2], {}),
      /INT32 value must be a finite integer/
    );
  });

  it('should report requested count mismatches', function () {
    const buf = parquetCodecDeltaBinaryPacked.encodeValues('INT32', [1, 2, 3], {});

    assert.throws(
      () => parquetCodecDeltaBinaryPacked.decodeValues('INT32', { buffer: buf, offset: 0 }, 2, {}),
      /value count 3 does not match requested count 2/
    );
  });
});
