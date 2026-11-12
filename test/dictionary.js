'use strict';
const chai = require('chai');
const assert = chai.assert;
const parquet = require('../parquet');
const path = require('path');
const fs = require('fs');

describe('dictionary encoding', function () {
  for (const physicalType of ['int32', 'int64', 'int64-low-precision']) {
    it(`should read dictionary-encoded ${physicalType} decimals`, async function () {
      const reader = await parquet.ParquetReader.openBuffer(
        fs.readFileSync(path.resolve(__dirname, `test-files/decimal-${physicalType}-dictionary.parquet`))
      );
      try {
        const cursor = reader.getCursor();
        const values = [12.34, -5.1, null, 12.34];
        for (const amount of values) {
          assert.deepEqual(await cursor.next(), { amount });
        }
        assert.isNull(await cursor.next());
      } finally {
        await reader.close();
      }
    });
  }

  it('should read uncompressed dictionary from spark', async function () {
    let reader = await parquet.ParquetReader.openFile(
      path.resolve(__dirname, 'test-files/spark-uncompressed-dict.parquet')
    );
    let cursor = reader.getCursor();
    let records = [];

    for (let i = 0; i < 5; i++) {
      records.push(await cursor.next());
    }

    assert.deepEqual(
      records.map((d) => d.name),
      ['apples', 'oranges', 'kiwi', 'banana', 'apples']
    );
  });
});
