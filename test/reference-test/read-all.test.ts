/* eslint mocha/no-setup-in-describe: 'off' */
import { expect } from 'chai';
import path from 'node:path';
import fs from 'node:fs';

import parquet from '../../parquet';
import { getFirstRecord } from './first-record';

// Used for testing a single file. Example:
// const onlyTest = 'single_nan.parquet';
const onlyTest = null;

// Test files currently unsupported / needing separate test
// eslint-disable-next-line mocha/no-exports
export const unsupported = [
  'binary_truncated_min_max.parquet',
  'byte_stream_split_extended.gzip.parquet', // should be tested separately
  'bson.parquet',
  'column_chunk_key_value_metadata.parquet',
  'datapage_v2_empty_datapage.snappy.parquet', //
  'datapage_v2.snappy.parquet', // DELTA_BINARY_PACKED unsupported
  'delta_binary_packed.parquet', // DELTA_BINARY_PACKED unsupported
  'delta_byte_array.parquet', // DELTA_BYTE_ARRAY unsupported
  'delta_encoding_optional_column.parquet', // DELTA_BINARY_PACKED unsupported
  'delta_encoding_required_column.parquet', // DELTA_BINARY_PACKED unsupported
  'delta_length_byte_array.parquet', // ZSTD unsupported, DELTA_BINARY_PACKED unsupported
  'floating_orders_nan_count.parquet',
  'incorrect_map_schema.parquet',
  'int96_from_spark.parquet',
  'int96_timestamp_order.parquet',
  'hadoop_lz4_compressed.parquet', // LZ4 unsupported
  'hadoop_lz4_compressed_larger.parquet', // LZ4 unsupported
  'large_string_map.brotli.parquet', // Fails as the large string is > 1 GB
  'lz4_raw_compressed.parquet', // LZ4_RAW unsupported
  'lz4_raw_compressed_larger.parquet', // LZ4_RAW unsupported
  'map_no_value.parquet',
  'nested_structs.rust.parquet', // ZSTD unsupported
  'non_hadoop_lz4_compressed.parquet', // ZSTD unsupported
  'old_list_structure.parquet',
  'page_v2_empty_compressed.parquet',
  'repeated_primitive_no_list.parquet',
  'rle_boolean_encoding.parquet', // BUG?: https://github.com/LibertyDSNP/parquetjs/issues/113
  'sort_columns.parquet',
  'unknown-logical-type.parquet',
];

describe('Read Test for all files', function () {
  const listOfFiles = fs
    .readdirSync(path.join(__dirname, 'files'))
    .filter((x) => x.endsWith('.parquet') && !unsupported.includes(x));

  for (const filename of listOfFiles) {
    if (onlyTest && onlyTest !== filename) continue;

    it(`Reading ${filename}`, async function () {
      const reader = await parquet.ParquetReader.openFile(path.join(__dirname, 'files', filename));
      const schema = reader.getSchema();
      expect(schema.fieldList).to.have.length.greaterThan(0);
      const cursor = reader.getCursor();
      const record = (await cursor.next()) as any;
      // Expect the same keys as top-level fields
      const expectedRecordKeys = schema.fieldList.filter((x) => x.path.length === 1).map((x) => x.name);
      expect(Object.keys(record)).to.deep.equal(expectedRecordKeys);

      // validate that the first record has the expected values
      const [shouldTest, expectedFirstRow] = getFirstRecord(filename);
      if (shouldTest) {
        expect(record).to.deep.equal(expectedFirstRow);
      }
    });
  }
});
