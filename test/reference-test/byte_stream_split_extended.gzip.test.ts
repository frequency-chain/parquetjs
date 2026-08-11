import { expect } from 'chai';
import path from 'node:path';

import parquet from '../../parquet';
describe('byte_stream_split_extended.gzip.parquet', function() {
  it(`Reading succeeds`, async function () {
    const filename = 'byte_stream_split_extended.gzip.parquet';
    const reader = await parquet.ParquetReader.openFile(path.join(__dirname, 'files', filename));
    const schema = reader.getSchema();
    expect(schema.fieldList).to.have.length.greaterThan(0);
    const cursor = reader.getCursor();
    const record = (await cursor.next()) as any;
    // Expect the same keys as top-level fields
    const expectedRecordKeys = schema.fieldList.filter((x) => x.path.length === 1).map((x) => x.name);
    expect(Object.keys(record)).to.deep.equal(expectedRecordKeys);

    // validate that the first record has the expected values
    const column_pairs: string[][] = [
      ['decimal_byte_stream_split', 'decimal_plain'],
      ['double_byte_stream_split', 'double_plain'],
      ['flba5_byte_stream_split', 'flba5_plain'],
      ['float16_byte_stream_split', 'float16_plain'],
      ['float_byte_stream_split', 'float_plain'],
      ['int32_byte_stream_split', 'int32_plain'],
      ['int64_byte_stream_split', 'int64_plain'],
    ];

    for (const pair of column_pairs) {
      console.log(`comparing ${pair[0]}  to ${pair[1]}`);
      expect(record[pair[0]]).to.deep.equal(record[pair[1]]);
    }
  });
});
