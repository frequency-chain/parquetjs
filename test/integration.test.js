'use strict';

/* eslint mocha/no-setup-in-describe: 'off', @typescript-eslint/no-empty-function: 'off' */

const chai = require('chai');
const fs = require('fs');
const assert = chai.assert;
const parquet = require('../parquet');
const parquet_thrift = require('../gen-nodejs/parquet_types');
const parquet_util = require('../lib/util');
const objectStream = require('object-stream');
const stream = require('stream');
const { expect } = require('chai');

const TEST_NUM_ROWS = 10000;
const TEST_VTIME = new Date();

function mkTestSchema(opts) {
  return new parquet.ParquetSchema({
    name: { type: 'UTF8', compression: opts.compression },
    quantity: { type: 'INT64', optional: true, compression: opts.compression },
    price: { type: 'DOUBLE', compression: opts.compression },
    date: { type: 'TIMESTAMP_MICROS', compression: opts.compression },
    day: { type: 'DATE', compression: opts.compression },
    finger: { type: 'FIXED_LEN_BYTE_ARRAY', compression: opts.compression, typeLength: 5 },
    inter: { type: 'INTERVAL', compression: opts.compression },
    stock: {
      repeated: true,
      fields: {
        quantity: { type: 'INT64', repeated: true },
        warehouse: { type: 'UTF8', compression: opts.compression },
      },
    },
    colour: { type: 'UTF8', repeated: true, compression: opts.compression },
    meta_json: { type: 'BSON', optional: true, compression: opts.compression },
  });
}

function mkTestRows(_opts) {
  let rows = [];

  for (let i = 0; i < TEST_NUM_ROWS; ++i) {
    rows.push({
      name: 'apples',
      quantity: 10n,
      price: 2.6,
      day: new Date('2017-11-26'),
      date: new Date(TEST_VTIME + 1000 * i),
      finger: 'FNORD',
      inter: { months: 42, days: 23, milliseconds: 777 },
      stock: [
        { quantity: 10n, warehouse: 'A' },
        { quantity: 20n, warehouse: 'B' },
      ],
      colour: ['green', 'red'],
    });

    rows.push({
      name: 'oranges',
      quantity: 20n,
      price: 2.7,
      day: new Date('2017-11-26'),
      date: new Date(TEST_VTIME + 2000 * i),
      finger: 'FNORD',
      inter: { months: 42, days: 23, milliseconds: 777 },
      stock: {
        quantity: [50n, 33n],
        warehouse: 'X',
      },
      colour: ['orange'],
    });

    rows.push({
      name: 'kiwi',
      price: 4.2,
      quantity: undefined,
      day: new Date('2017-11-26'),
      date: new Date(TEST_VTIME + 8000 * i),
      finger: 'FNORD',
      inter: { months: 42, days: 23, milliseconds: 777 },
      stock: [
        { quantity: 42n, warehouse: 'f' },
        { quantity: 20n, warehouse: 'x' },
      ],
      colour: ['green', 'brown'],
      meta_json: { expected_ship_date: TEST_VTIME },
    });

    rows.push({
      name: 'banana',
      price: 3.2,
      day: new Date('2017-11-26'),
      date: new Date(TEST_VTIME + 6000 * i),
      finger: 'FNORD',
      inter: { months: 42, days: 23, milliseconds: 777 },
      colour: ['yellow'],
      meta_json: { shape: 'curved' },
    });
  }

  return rows;
}

async function writeTestFile(opts) {
  let schema = mkTestSchema(opts);

  let writer = await parquet.ParquetWriter.openFile(schema, 'fruits.parquet', opts);
  writer.setMetadata('myuid', '420');
  writer.setMetadata('fnord', 'dronf');

  let rows = mkTestRows(opts);

  for (let row of rows) {
    await writer.appendRow(row);
  }

  await writer.close();
}

async function writeTestStream(opts) {
  let schema = mkTestSchema(opts);

  var out = new stream.PassThrough();
  let writer = await parquet.ParquetWriter.openStream(schema, out, opts);
  out.on('data', function (_d) {});
  out.on('end', function () {});

  writer.setMetadata('myuid', '420');
  writer.setMetadata('fnord', 'dronf');

  let rows = mkTestRows(opts);

  for (let row of rows) {
    await writer.appendRow(row);
  }

  await writer.close();
}

async function sampleColumnHeaders() {
  let reader = await parquet.ParquetReader.openFile('fruits.parquet');
  let column = reader.metadata.row_groups[0].columns[0];
  let buffer = await reader.envelopeReader.read(
    +column.meta_data.data_page_offset,
    +column.meta_data.total_compressed_size
  );

  let cursor = {
    buffer: buffer,
    offset: 0,
    size: buffer.length,
  };

  const pages = [];

  while (cursor.offset < cursor.size) {
    const pageHeader = new parquet_thrift.PageHeader();
    cursor.offset += parquet_util.decodeThrift(pageHeader, cursor.buffer.subarray(cursor.offset));
    pages.push(pageHeader);
    cursor.offset += pageHeader.compressed_page_size;
  }

  return { column, pages };
}

async function verifyBloomFilterOffset() {
  const headers = await sampleColumnHeaders();
  const {
    column: {
      meta_data: { bloom_filter_offset },
    },
  } = headers;

  assert.equal(parseInt(bloom_filter_offset), 4106725);
}

async function verifyPages() {
  let rowCount = 0;
  const column = await sampleColumnHeaders();

  column.pages.forEach((d) => {
    let header = d.data_page_header || d.data_page_header_v2;
    assert.isAbove(header.num_values, 0);
    rowCount += header.num_values;
  });

  assert.isAbove(column.pages.length, 1);
  assert.equal(rowCount, column.column.meta_data.num_values);
}

async function verifyStatistics() {
  const column = await sampleColumnHeaders();
  const colStats = column.column.meta_data.statistics;

  assert.equal(colStats.max_value, 'oranges');
  assert.equal(colStats.min_value, 'apples');
  assert.equal(colStats.null_count, 0);
  assert.equal(colStats.distinct_count, 4);

  column.pages.forEach((d, _i) => {
    let header = d.data_page_header || d.data_page_header_v2;
    let pageStats = header.statistics;
    assert.equal(pageStats.null_count, 0);
    assert.equal(pageStats.distinct_count, 4);
    assert.equal(pageStats.max_value, 'oranges');
    assert.equal(pageStats.min_value, 'apples');
  });
}

async function readTestFile() {
  let reader = await parquet.ParquetReader.openFile('fruits.parquet');
  assert.equal(reader.getRowCount(), TEST_NUM_ROWS * 4);
  assert.deepEqual(reader.getMetadata(), { myuid: '420', fnord: 'dronf' });

  let schema = reader.getSchema();
  assert.equal(schema.fieldList.length, 12);
  assert(schema.fields.name);
  assert(schema.fields.stock);
  assert(schema.fields.stock.fields.quantity);
  assert(schema.fields.stock.fields.warehouse);
  assert(schema.fields.price);

  {
    const c = schema.fields.name;
    assert.equal(c.name, 'name');
    assert.equal(c.primitiveType, 'BYTE_ARRAY');
    assert.equal(c.originalType, 'UTF8');
    assert.deepEqual(c.path, ['name']);
    assert.equal(c.repetitionType, 'REQUIRED');
    assert.equal(c.encoding, 'PLAIN');
    assert.equal(c.compression, 'UNCOMPRESSED');
    assert.equal(c.rLevelMax, 0);
    assert.equal(c.dLevelMax, 0);
    assert.equal(!!c.isNested, false);
    assert.equal(c.fieldCount, undefined);
  }

  {
    const c = schema.fields.stock;
    assert.equal(c.name, 'stock');
    assert.equal(c.primitiveType, undefined);
    assert.equal(c.originalType, undefined);
    assert.deepEqual(c.path, ['stock']);
    assert.equal(c.repetitionType, 'REPEATED');
    assert.equal(c.encoding, undefined);
    assert.equal(c.compression, undefined);
    assert.equal(c.rLevelMax, 1);
    assert.equal(c.dLevelMax, 1);
    assert.equal(!!c.isNested, true);
    assert.equal(c.fieldCount, 2);
  }

  {
    const c = schema.fields.stock.fields.quantity;
    assert.equal(c.name, 'quantity');
    assert.equal(c.primitiveType, 'INT64');
    assert.equal(c.originalType, undefined);
    assert.deepEqual(c.path, ['stock', 'quantity']);
    assert.equal(c.repetitionType, 'REPEATED');
    assert.equal(c.encoding, 'PLAIN');
    assert.equal(c.compression, 'UNCOMPRESSED');
    assert.equal(c.rLevelMax, 2);
    assert.equal(c.dLevelMax, 2);
    assert.equal(!!c.isNested, false);
    assert.equal(c.fieldCount, undefined);
  }

  {
    const c = schema.fields.stock.fields.warehouse;
    assert.equal(c.name, 'warehouse');
    assert.equal(c.primitiveType, 'BYTE_ARRAY');
    assert.equal(c.originalType, 'UTF8');
    assert.deepEqual(c.path, ['stock', 'warehouse']);
    assert.equal(c.repetitionType, 'REQUIRED');
    assert.equal(c.encoding, 'PLAIN');
    assert.equal(c.compression, 'UNCOMPRESSED');
    assert.equal(c.rLevelMax, 1);
    assert.equal(c.dLevelMax, 1);
    assert.equal(!!c.isNested, false);
    assert.equal(c.fieldCount, undefined);
  }

  {
    const c = schema.fields.price;
    assert.equal(c.name, 'price');
    assert.equal(c.primitiveType, 'DOUBLE');
    assert.equal(c.originalType, undefined);
    assert.deepEqual(c.path, ['price']);
    assert.equal(c.repetitionType, 'REQUIRED');
    assert.equal(c.encoding, 'PLAIN');
    assert.equal(c.compression, 'UNCOMPRESSED');
    assert.equal(c.rLevelMax, 0);
    assert.equal(c.dLevelMax, 0);
    assert.equal(!!c.isNested, false);
    assert.equal(c.fieldCount, undefined);
  }

  {
    let cursor = reader.getCursor();
    for (let i = 0; i < TEST_NUM_ROWS; ++i) {
      assert.deepEqual(await cursor.next(), {
        name: 'apples',
        quantity: 10n,
        price: 2.6,
        day: new Date('2017-11-26'),
        date: new Date(TEST_VTIME + 1000 * i),
        finger: Buffer.from('FNORD'),
        inter: { months: 42, days: 23, milliseconds: 777 },
        stock: [
          { quantity: [10n], warehouse: 'A' },
          { quantity: [20n], warehouse: 'B' },
        ],
        colour: ['green', 'red'],
        meta_json: null,
      });

      assert.deepEqual(await cursor.next(), {
        name: 'oranges',
        quantity: 20n,
        price: 2.7,
        day: new Date('2017-11-26'),
        date: new Date(TEST_VTIME + 2000 * i),
        finger: Buffer.from('FNORD'),
        inter: { months: 42, days: 23, milliseconds: 777 },
        stock: [{ quantity: [50n, 33n], warehouse: 'X' }],
        colour: ['orange'],
        meta_json: null,
      });

      assert.deepEqual(await cursor.next(), {
        name: 'kiwi',
        quantity: null,
        price: 4.2,
        day: new Date('2017-11-26'),
        date: new Date(TEST_VTIME + 8000 * i),
        finger: Buffer.from('FNORD'),
        inter: { months: 42, days: 23, milliseconds: 777 },
        stock: [
          { quantity: [42n], warehouse: 'f' },
          { quantity: [20n], warehouse: 'x' },
        ],
        colour: ['green', 'brown'],
        meta_json: { expected_ship_date: TEST_VTIME },
      });

      assert.deepEqual(await cursor.next(), {
        name: 'banana',
        quantity: null,
        price: 3.2,
        day: new Date('2017-11-26'),
        date: new Date(TEST_VTIME + 6000 * i),
        finger: Buffer.from('FNORD'),
        inter: { months: 42, days: 23, milliseconds: 777 },
        stock: null,
        colour: ['yellow'],
        meta_json: { shape: 'curved' },
      });
    }

    assert.equal(await cursor.next(), null);
  }

  {
    let cursor = reader.getCursor(['name']);
    for (let i = 0; i < TEST_NUM_ROWS; ++i) {
      assert.deepEqual(await cursor.next(), { name: 'apples' });
      assert.deepEqual(await cursor.next(), { name: 'oranges' });
      assert.deepEqual(await cursor.next(), { name: 'kiwi' });
      assert.deepEqual(await cursor.next(), { name: 'banana' });
    }
    assert.equal(await cursor.next(), null);
  }

  {
    let cursor = reader.getCursor(['name', 'quantity']);
    for (let i = 0; i < TEST_NUM_ROWS; ++i) {
      assert.deepEqual(await cursor.next(), { name: 'apples', quantity: 10n });
      assert.deepEqual(await cursor.next(), { name: 'oranges', quantity: 20n });
      assert.deepEqual(await cursor.next(), { name: 'kiwi', quantity: null });
      assert.deepEqual(await cursor.next(), { name: 'banana', quantity: null });
    }

    assert.equal(await cursor.next(), null);
  }

  await reader.close();
}

describe('Parquet', function () {
  this.timeout(60000);

  describe('with defaults', function () {
    it('write a test stream', function () {
      return writeTestStream({});
    });
  });

  describe('with DataPageHeaderV1', function () {
    it('write a test file', function () {
      const opts = { useDataPageV2: false, compression: 'UNCOMPRESSED' };
      return writeTestFile(opts);
    });

    it('write a test file and then read it back', function () {
      const opts = { useDataPageV2: false, pageSize: 2000, compression: 'UNCOMPRESSED' };
      return writeTestFile(opts).then(readTestFile);
    });

    it('verify that data is split into pages', function () {
      return verifyPages();
    });

    it('verify statistics', function () {
      return verifyStatistics();
    });
  });

  describe('with BloomFilterHeader', function () {
    const bloomFilters = [
      {
        column: 'name',
        numFilterBytes: 1024,
      },
    ];

    it('write a test file', function () {
      const opts = { useDataPageV2: true, compression: 'UNCOMPRESSED', bloomFilters };
      return writeTestFile(opts);
    });

    it('write a test file and then read it back', function () {
      const opts = { useDataPageV2: true, pageSize: 2000, compression: 'UNCOMPRESSED', bloomFilters };
      return writeTestFile(opts).then(readTestFile);
    });

    it('verify that bloom filter offset is set', function () {
      return verifyBloomFilterOffset();
    });
  });

  describe('with DataPageHeaderV2', function () {
    it('write a test file', function () {
      const opts = { useDataPageV2: true, compression: 'UNCOMPRESSED' };
      return writeTestFile(opts);
    });

    it('write a test file and then read it back', async function () {
      const opts = { useDataPageV2: true, pageSize: 2000, compression: 'UNCOMPRESSED' };
      return writeTestFile(opts).then(readTestFile);
    });

    it('verify that data is split into pages', function () {
      return verifyPages();
    });

    it('verify statistics', function () {
      return verifyStatistics();
    });

    for (let compression of [
      'GZIP',
      'SNAPPY',
      'BROTLI',
      'ZSTD',
      // 'LZO',
      // 'LZ4',
    ]) {
      it(`write a test file with ${compression} compression and then read it back`, function() {
          const opts = { useDataPageV2: true, compression };
          return writeTestFile(opts).then(readTestFile);
      });
    }

    it('write a Uint8Array field with UNCOMPRESSED and then read it back', async function () {
      const opts = { useDataPageV2: true, compression: 'UNCOMPRESSED' };
      const schema = new parquet.ParquetSchema({
        data: { type: 'BYTE_ARRAY', compression: opts.compression },
      });
      let writer = await parquet.ParquetWriter.openFile(schema, 'fruits.parquet', opts);
      writer.setMetadata('myuid', '420');
      writer.setMetadata('fnord', 'dronf');

      await writer.appendRow({ data: Uint8Array.from([12345, 365]) });
      await writer.close();

      let reader = await parquet.ParquetReader.openFile('fruits.parquet');
      assert.equal(reader.getRowCount(), 1);
      assert.deepEqual(reader.getMetadata(), { myuid: '420', fnord: 'dronf' });

      let readSchema = reader.getSchema();
      assert.equal(readSchema.fieldList.length, 1);
      assert(schema.fields.data);

      let cursor = reader.getCursor();
      assert.deepEqual(await cursor.next(), { data: Uint8Array.from([12345, 365]) });

      assert.equal(await cursor.next(), null);
    });

    const non_exhaustive_unsupported_list = [
      { data: Uint16Array.from([12345, 365]) },
      { data: Uint32Array.from([12345, 365]) },
      { data: Float32Array.from([12345, 365]) },
      { data: Float64Array.from([12345, 365]) },
    ];

    non_exhaustive_unsupported_list.forEach((row) => {
      it('unsupported typed array ' + row.data.constructor.name + ' should throw error', async function () {
        const opts = { useDataPageV2: true, compression: 'UNCOMPRESSED' };
        const schema = new parquet.ParquetSchema({
          data: { type: 'BYTE_ARRAY', compression: opts.compression },
        });
        let writer = await parquet.ParquetWriter.openFile(schema, 'fruits.parquet', opts);
        let gotError = false;
        try {
          await writer.appendRow(row);
          await writer.close();
        } catch (e) {
          gotError = true;
          expect(e).to.match(/is not supported/);
        }
        expect(gotError).to.eq(true);
      });
    });
  });

  describe('using the Stream/Transform API', function () {
    it('write a test file', async function () {
      const opts = { useDataPageV2: true, compression: 'GZIP' };
      let schema = mkTestSchema(opts);
      let transform = new parquet.ParquetTransformer(schema, opts);
      transform.writer.setMetadata('myuid', '420');
      transform.writer.setMetadata('fnord', 'dronf');

      var ostream = fs.createWriteStream('fruits_stream.parquet');
      let istream = objectStream.fromArray(mkTestRows());
      istream.pipe(transform).pipe(ostream);
    });

    it('an error in transform is emitted in stream', async function () {
      const opts = { useDataPageV2: true, compression: 'GZIP' };
      let schema = mkTestSchema(opts);
      let transform = new parquet.ParquetTransformer(schema, opts);
      transform.writer.setMetadata('myuid', '420');
      transform.writer.setMetadata('fnord', 'dronf');

      var ostream = fs.createWriteStream('fruits_stream.parquet');
      let testRows = mkTestRows();
      testRows[4].quantity = 'N/A';
      let istream = objectStream.fromArray(testRows);
      return new Promise((resolve, reject) => {
        setTimeout(() => resolve('no_error'), 1000);
        istream.pipe(transform).on('error', reject).pipe(ostream).on('finish', resolve);
      }).then(
        () => {
          throw new Error('Should emit error');
        },
        () => undefined
      );
    });
  });

  describe('Decimal schema', function () {
    const schema = new parquet.ParquetSchema({
      zero_column: { type: 'DECIMAL', precision: 10, scale: 0 },
      no_scale_column: { type: 'DECIMAL', precision: 10 },
      scale_64_column: { type: 'DECIMAL', precision: 10, scale: 2 },
      scale_32_column: { type: 'DECIMAL', precision: 8, scale: 2 },
      fixed_length_column: { type: 'DECIMAL', typeLength: 4, precision: 20, scale: 2 },
      non_fixed_length_column: { type: 'DECIMAL', precision: 20, scale: 2 },
    });

    const rowData = {
      zero_column: 1,
      no_scale_column: 2,
      scale_64_column: 3.345678901234567,
      scale_32_column: 3.3,
      fixed_length_column: Buffer.from([0x0, 0x0, 0x0, 0x64]), // 0x64 = 100 = 1 * 10 ** 2 = value * 10 ** scale
      non_fixed_length_column: Buffer.from([[0x64]]), // 0x64 = 100 = 1 * 10 ** 2 = value * 10 ** scale
    };

    it('write a test file with decimals in v1 data page and read it back', async function () {
      const file = 'decimal-test-v1.parquet';
      const opts = { useDataPageV2: false };
      const writer = await parquet.ParquetWriter.openFile(schema, file, opts);

      await writer.appendRow(rowData);
      await writer.close();

      const reader = await parquet.ParquetReader.openFile(file);

      const cursor = reader.getCursor();
      const row = await cursor.next();
      assert.deepEqual(row, {
        zero_column: 1,
        no_scale_column: 2,
        scale_64_column: 3.34, // Scale 2
        scale_32_column: 3.3,
        fixed_length_column: Buffer.from([0x0, 0x0, 0x0, 0x64]),
        non_fixed_length_column: Buffer.from([0x64]),
      });
    });

    it('write a test file with decimals in v2 data page and read it back', async function () {
      const file = 'decimal-test-v2.parquet';
      const opts = { useDataPageV2: true };
      const writer = await parquet.ParquetWriter.openFile(schema, file, opts);

      await writer.appendRow(rowData);
      await writer.close();

      const reader = await parquet.ParquetReader.openFile(file);

      const cursor = reader.getCursor();
      const row = await cursor.next();
      assert.deepEqual(row, {
        zero_column: 1,
        no_scale_column: 2,
        scale_64_column: 3.34, // Scale 2
        scale_32_column: 3.3,
        fixed_length_column: Buffer.from([0x0, 0x0, 0x0, 0x64]),
        non_fixed_length_column: Buffer.from([0x64]),
      });
    });
  });
});
