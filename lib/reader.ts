import Int64 from 'node-int64';
import parquet_thrift from '../gen-nodejs/parquet_types';
import * as parquet_shredder from './shred';
import * as parquet_util from './util';
import * as parquet_schema from './schema';
import * as parquet_codec from './codec';
import * as parquet_compression from './compression';
import * as parquet_types from './types';
import BufferReader, { BufferReaderOptions } from './bufferReader';
import * as bloomFilterReader from './bloomFilterIO/bloomFilterReader';
import {
  ParquetCodec,
  Parameter,
  PageData,
  SchemaDefinition,
  ParquetType,
  FieldDefinition,
  ParquetField,
  ClientS3,
  ClientParameters,
  FileMetaDataExt,
  NewPageHeader,
  RowGroupExt,
  ColumnChunkExt,
} from './declare';
import { Cursor, Options } from './codec/types';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import type { Blob } from 'buffer';

const { getBloomFiltersFor } = bloomFilterReader;

/**
 * Parquet File Magic String
 */
const PARQUET_MAGIC = 'PAR1';

/**
 * Supported Parquet File Format Version for reading
 */
const PARQUET_VERSIONS = [1, 2];

/**
 * Internal type used for repetition/definition levels
 */
const PARQUET_RDLVL_TYPE = 'INT32';
const PARQUET_RDLVL_ENCODING = 'RLE';

/**
 * A parquet cursor is used to retrieve rows from a parquet file in order
 */
class ParquetCursor {
  metadata: FileMetaDataExt;
  envelopeReader: ParquetEnvelopeReader;
  schema: parquet_schema.ParquetSchema;
  columnList: unknown[][];
  rowGroup: unknown[];
  rowGroupIndex: number;
  cursorIndex: number;

  /**
   * Create a new parquet reader from the file metadata and an envelope reader.
   * It is usually not recommended to call this constructor directly except for
   * advanced and internal use cases. Consider using getCursor() on the
   * ParquetReader instead
   */
  constructor(
    metadata: FileMetaDataExt,
    envelopeReader: ParquetEnvelopeReader,
    schema: parquet_schema.ParquetSchema,
    columnList: unknown[][]
  ) {
    this.metadata = metadata;
    this.envelopeReader = envelopeReader;
    this.schema = schema;
    this.columnList = columnList;
    this.rowGroup = [];
    this.rowGroupIndex = 0;
    this.cursorIndex = 0;
  }

  /**
   * Retrieve the next row from the cursor. Returns a row or NULL if the end
   * of the file was reached
   */
  async next() {
    if (this.cursorIndex >= this.rowGroup.length) {
      if (this.rowGroupIndex >= this.metadata.row_groups.length) {
        return null;
      }

      const rowBuffer = await this.envelopeReader.readRowGroup(
        this.schema,
        this.metadata.row_groups[this.rowGroupIndex],
        this.columnList
      );

      this.rowGroup = parquet_shredder.materializeRecords(this.schema, rowBuffer);
      this.rowGroupIndex++;
      this.cursorIndex = 0;
    }

    return this.rowGroup[this.cursorIndex++];
  }

  /**
   * Rewind the cursor to the beginning of the file
   */
  rewind() {
    this.rowGroup = [];
    this.rowGroupIndex = 0;
    this.cursorIndex = 0;
  }
}

/**
 * A parquet reader allows retrieving the rows from a parquet file in order.
 * The basic usage is to create a reader and then retrieve a cursor/iterator
 * which allows you to consume row after row until all rows have been read. It is
 * important that you call close() after you are finished reading the file to
 * avoid leaking file descriptors.
 */
export class ParquetReader {
  envelopeReader: ParquetEnvelopeReader | null;
  metadata: FileMetaDataExt | null;
  schema: parquet_schema.ParquetSchema;
  treatInt96AsTimestamp: boolean;

  /**
   * Open the parquet file pointed to by the specified path and return a new
   * parquet reader
   */
  static async openFile(filePath: string | Buffer | URL, options?: BufferReaderOptions) {
    const envelopeReader = await ParquetEnvelopeReader.openFile(filePath, options);
    return this.openEnvelopeReader(envelopeReader, options);
  }

  static async openBuffer(buffer: Buffer, options?: BufferReaderOptions) {
    const envelopeReader = await ParquetEnvelopeReader.openBuffer(buffer, options);
    return this.openEnvelopeReader(envelopeReader, options);
  }

  /**
   * Open the parquet file from S3 using the supplied aws client [, commands] and params
   * The params have to include `Bucket` and `Key` to the file requested,
   * If using v3 of the AWS SDK, combine the client and commands into an object wiht keys matching
   * the original module names, and do not instantiate the commands; pass them as classes/modules.
   *
   * This function returns a new parquet reader [ or throws an Error.]
   */
  static async openS3(client: any, params: ClientParameters, options?: BufferReaderOptions) {
    try {
      const envelopeReader: ParquetEnvelopeReader =
        'function' === typeof client['headObject']
          ? await ParquetEnvelopeReader.openS3(client as ClientS3, params, options) // S3 client v2
          : await ParquetEnvelopeReader.openS3v3(client as S3Client, params, options); // S3 client v3
      return this.openEnvelopeReader(envelopeReader, options);
    } catch (e: any) {
      throw new Error(`Error accessing S3 Bucket ${params.Bucket}. Message: ${e.message}`);
    }
  }

  /**
   * Open the parquet file from a url using the supplied request module
   * params should either be a string (url) or an object that includes
   * a `url` property.
   * This function returns a new parquet reader
   */
  static async openUrl(params: Parameter | URL | string, options?: BufferReaderOptions) {
    const envelopeReader = await ParquetEnvelopeReader.openUrl(params, options);
    return this.openEnvelopeReader(envelopeReader, options);
  }

  static async openEnvelopeReader(envelopeReader: ParquetEnvelopeReader, opts?: BufferReaderOptions) {
    if (opts?.metadata) {
      return new ParquetReader(opts.metadata, envelopeReader, opts);
    }
    try {
      await envelopeReader.readHeader();

      const metadata = await envelopeReader.readFooter();

      return new ParquetReader(metadata, envelopeReader, opts);
    } catch (err) {
      await envelopeReader.close();
      throw err;
    }
  }

  /**
   * Create a new parquet reader from the file metadata and an envelope reader.
   * It is not recommended to call this constructor directly except for advanced
   * and internal use cases. Consider using one of the open{File,Buffer} methods
   * instead
   */
  constructor(metadata: FileMetaDataExt, envelopeReader: ParquetEnvelopeReader, opts?: BufferReaderOptions) {
    opts = opts || {};

    if (!PARQUET_VERSIONS.includes(metadata.version)) {
      throw new Error('invalid parquet version');
    }

    // Default to false for backward compatibility
    this.treatInt96AsTimestamp = opts.treatInt96AsTimestamp === true;

    // If metadata is a json file then we need to convert INT64 and CTIME
    if (metadata.json) {
      const convert = (o: Record<string, any>) => {
        if (o && typeof o === 'object') {
          Object.keys(o).forEach((key) => (o[key] = convert(o[key])));
          if (o.parquetType === 'CTIME') {
            return new Date(o.value);
          } else if (o.parquetType === 'INT64') {
            return new Int64(Buffer.from(o.value));
          }
        }
        return o;
      };

      // Go through all PageLocation objects and set the proper prototype
      metadata.row_groups.forEach((rowGroup) => {
        rowGroup.columns.forEach((column) => {
          if (column.offsetIndex) {
            Promise.resolve(column.offsetIndex).then((offset) =>
              offset.page_locations.forEach((d) => {
                if (Array.isArray(d)) {
                  Object.setPrototypeOf(d, parquet_thrift.PageLocation.prototype);
                }
              })
            );
          }
        });
      });

      convert(metadata);
    }

    this.metadata = envelopeReader.metadata = metadata;
    this.envelopeReader = envelopeReader;
    this.schema = envelopeReader.schema = new parquet_schema.ParquetSchema(
      decodeSchema(this.metadata.schema.slice(1)) as SchemaDefinition
    );

    /* decode any statistics values */
    if (this.metadata.row_groups && !this.metadata.json && !opts.rawStatistics) {
      this.metadata.row_groups.forEach((row) =>
        row.columns.forEach((col) => {
          const stats = col.meta_data!.statistics;
          if (stats) {
            const field = this.schema.findField(col.meta_data!.path_in_schema);
            stats.max_value = decodeStatisticsValue(stats.max_value, field);
            stats.min_value = decodeStatisticsValue(stats.min_value, field);
            stats.min = decodeStatisticsValue(stats.min, field);
            stats.max = decodeStatisticsValue(stats.max, field);
          }
        })
      );
    }
  }

  /**
   * Support `for await` iterators on the reader object
   * Uses `ParquetCursor` still under the hood.
   *
   * ```js
   *  for await (const record of reader) {
   *    console.log(record);
   *  }
   * ```
   */
  async *[Symbol.asyncIterator]() {
    const cursor = this.getCursor();
    let record = null;
    while ((record = await cursor.next())) {
      yield record;
    }
  }

  /**
   * Return a cursor to the file. You may open more than one cursor and use
   * them concurrently. All cursors become invalid once close() is called on
   * the reader object.
   *
   * The required_columns parameter controls which columns are actually read
   * from disk. An empty array or no value implies all columns. A list of column
   * names means that only those columns should be loaded from disk.
   */
  getCursor(columnList?: unknown[][]) {
    if (!columnList) {
      columnList = [];
    }

    columnList = columnList.map((x: unknown[]) => (x.constructor === Array ? x : [x]));

    return new ParquetCursor(this.metadata!, this.envelopeReader!, this.schema, columnList);
  }

  async getBloomFiltersFor(columnNames: string[]) {
    const bloomFilterData = await getBloomFiltersFor(columnNames, this.envelopeReader!);
    return bloomFilterData.reduce((acc: Record<string, typeof bloomFilterData>, value) => {
      if (acc[value.columnName]) acc[value.columnName].push(value);
      else acc[value.columnName] = [value];
      return acc;
    }, {});
  }

  /**
   * Return the number of rows in this file. Note that the number of rows is
   * not necessarily equal to the number of rows in each column.
   */
  getRowCount() {
    return this.metadata!.num_rows;
  }

  /**
   * Returns the ParquetSchema for this file
   */
  getSchema() {
    return this.schema;
  }

  /**
   * Returns the user (key/value) metadata for this file
   */
  getMetadata() {
    const md: Record<string, unknown> = {};
    for (const kv of this.metadata!.key_value_metadata!) {
      md[kv.key] = kv.value;
    }

    return md;
  }

  async exportMetadata(indent: string | number | undefined) {
    function replacer(_key: unknown, value: parquet_thrift.PageLocation | bigint | Record<string, any>) {
      if (value instanceof parquet_thrift.PageLocation) {
        return [value.offset, value.compressed_page_size, value.first_row_index];
      }

      if (typeof value === 'object') {
        for (const k in value) {
          if (value[k] instanceof Date) {
            value[k].toJSON = () =>
              JSON.stringify({
                parquetType: 'CTIME',
                value: value[k].valueOf(),
              });
          }
        }
      }

      if (typeof value === 'bigint') {
        return value.toString();
      }

      if (value instanceof Int64) {
        if (isFinite(Number(value))) {
          return Number(value);
        } else {
          return {
            parquetType: 'INT64',
            value: [...value.buffer],
          };
        }
      } else {
        return value;
      }
    }
    const metadata = Object.assign({}, this.metadata, { json: true });

    for (let i = 0; i < metadata.row_groups.length; i++) {
      const rowGroup = metadata.row_groups[i];
      for (let j = 0; j < rowGroup.columns.length; j++) {
        const column = rowGroup.columns[j];
        if (column.offsetIndex instanceof Promise) {
          column.offsetIndex = await column.offsetIndex;
        }
        if (column.columnIndex instanceof Promise) {
          column.columnIndex = await column.columnIndex;
        }
      }
    }

    return JSON.stringify(metadata, replacer, indent);
  }

  /**
   * Close this parquet reader. You MUST call this method once you're finished
   * reading rows
   */
  async close() {
    if (this.envelopeReader) {
      await this.envelopeReader.close();
    }

    this.envelopeReader = null;
    this.metadata = null;
  }

  decodePages(buffer: Buffer, opts: Options) {
    return decodePages(buffer, opts);
  }
}

/**
 * The parquet envelope reader allows direct, unbuffered access to the individual
 * sections of the parquet file, namely the header, footer and the row groups.
 * This class is intended for advanced/internal users; if you just want to retrieve
 * rows from a parquet file use the ParquetReader instead
 */
let ParquetEnvelopeReaderIdCounter = 0;

export class ParquetEnvelopeReader {
  readFn: (offset: number, length: number, file?: string) => Promise<Buffer>;
  close: () => unknown;
  id: number;
  fileSize: number | (() => Promise<number>);
  default_dictionary_size: number;
  metadata?: FileMetaDataExt;
  schema?: parquet_schema.ParquetSchema;
  treatInt96AsTimestamp?: boolean;

  static async openFile(filePath: string | Buffer | URL, options?: BufferReaderOptions) {
    const fileStat = await parquet_util.fstat(filePath);
    const fileDescriptor = await parquet_util.fopen(filePath);

    const readFn = (offset: number, length: number, file?: string) => {
      if (file) {
        return Promise.reject('external references are not supported');
      }

      return parquet_util.fread(fileDescriptor, offset, length);
    };

    const closeFn = parquet_util.fclose.bind(undefined, fileDescriptor);

    return new ParquetEnvelopeReader(readFn, closeFn, fileStat.size, options);
  }

  static async openBuffer(buffer: Buffer, options?: BufferReaderOptions) {
    const readFn = (offset: number, length: number, file?: string) => {
      if (file) {
        return Promise.reject('external references are not supported');
      }

      return Promise.resolve(buffer.subarray(offset, offset + length));
    };

    const closeFn = () => ({});
    return new ParquetEnvelopeReader(readFn, closeFn, buffer.length, options);
  }

  static async openS3(client: ClientS3, params: ClientParameters, options?: BufferReaderOptions) {
    const fileStat = async () =>
      client
        .headObject(params)
        .promise()
        .then((d: { ContentLength: number }) => d.ContentLength);

    const readFn = async (offset: number, length: number, file?: string) => {
      if (file) {
        return Promise.reject('external references are not supported');
      }

      const Range = `bytes=${offset}-${offset + length - 1}`;
      const res = await client.getObject(Object.assign({ Range }, params)).promise();
      return Promise.resolve(res.Body);
    };

    const closeFn = () => ({});

    return new ParquetEnvelopeReader(readFn, closeFn, fileStat, options);
  }

  static async openS3v3(client: S3Client, params: any, options: any) {
    const fileStat = async () => {
      try {
        const headObjectCommand = await client.send(new HeadObjectCommand(params));
        if (headObjectCommand.ContentLength === undefined) {
          throw new Error('Content Length is undefined!');
        }
        return Promise.resolve(headObjectCommand.ContentLength);
      } catch (e: any) {
        // having params match command names makes e.message clear to user
        return Promise.reject('rejected headObjectCommand: ' + e.message);
      }
    };

    const readFn = async (offset: number, length: number, file: string | undefined): Promise<Buffer> => {
      if (file) {
        return Promise.reject('external references are not supported');
      }
      const Range = `bytes=${offset}-${offset + length - 1}`;
      const input = { ...{ Range }, ...params };
      const response = await client.send(new GetObjectCommand(input));

      const body = response.Body;
      if (body) {
        return ParquetEnvelopeReader.streamToBuffer(body);
      }
      return Buffer.of();
    };

    const closeFn = () => ({});

    return new ParquetEnvelopeReader(readFn, closeFn, fileStat, options);
  }

  static async streamToBuffer(body: any): Promise<Buffer> {
    const blob = body as Blob;
    if (blob.arrayBuffer !== undefined) {
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array: Uint8Array = new Uint8Array(arrayBuffer);
      return Buffer.from(uint8Array);
    }

    //Assumed to be a Readable like object
    const readable = body as Readable;
    return await new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      readable.on('data', (chunk) => chunks.push(chunk));
      readable.on('error', reject);
      readable.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  static async openUrl(url: Parameter | URL | string, options?: BufferReaderOptions) {
    let params: Parameter;
    if (typeof url === 'string') params = { url };
    else if (url instanceof URL) params = { url: url.toString() };
    else params = url;

    if (!params.url) throw new Error('URL missing');

    const baseArr = params.url.split('/');
    const base = baseArr.slice(0, baseArr.length - 1).join('/') + '/';

    const defaultHeaders = params.headers || {};

    const filesize = async (): Promise<number> => {
      const { headers } = await fetch(params.url);
      return Number(headers.get('Content-Length')) || 0;
    };

    const readFn = async (offset: number, length: number, file?: string) => {
      const url = file ? base + file : params.url;
      const range = `bytes=${offset}-${offset + length - 1}`;
      const headers = Object.assign({}, defaultHeaders, { range });
      const response = await fetch(url, { headers });
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return buffer;
    };

    const closeFn = () => ({});

    return new ParquetEnvelopeReader(readFn, closeFn, filesize, options);
  }

  constructor(
    readFn: (offset: number, length: number, file?: string) => Promise<Buffer>,
    closeFn: () => unknown,
    fileSize: number | (() => Promise<number>),
    options?: BufferReaderOptions,
    metadata?: FileMetaDataExt
  ) {
    options = options || {};
    this.readFn = readFn;
    this.id = ++ParquetEnvelopeReaderIdCounter;
    this.close = closeFn;
    this.fileSize = fileSize;
    this.default_dictionary_size = options.default_dictionary_size || 10000000;
    this.metadata = metadata;
    this.treatInt96AsTimestamp = options.treatInt96AsTimestamp === true;
    if (options.maxLength || options.maxSpan || options.queueWait) {
      const bufferReader = new BufferReader(this, options);
      this.read = (offset, length) => bufferReader.read(offset, length);
    }
  }

  read(offset: number, length: number, file?: string) {
    return this.readFn(offset, length, file!);
  }

  readHeader() {
    return this.read(0, PARQUET_MAGIC.length).then((buf: Buffer) => {
      if (buf.toString() != PARQUET_MAGIC) {
        throw new Error('not valid parquet file');
      }
    });
  }

  // Helper function to get the column object for a particular path and row_group
  getColumn(
    path: string | parquet_thrift.ColumnChunk,
    row_group: RowGroupExt | number | string | null
  ): ColumnChunkExt {
    let column;
    let parsedRowGroup: parquet_thrift.RowGroup | undefined;
    if (!isNaN(Number(row_group))) {
      parsedRowGroup = this.metadata?.row_groups[Number(row_group)];
    } else if (row_group instanceof parquet_thrift.RowGroup) {
      parsedRowGroup = row_group;
    }

    if (typeof path === 'string') {
      if (!parsedRowGroup) {
        throw new Error(`Missing RowGroup ${row_group}`);
      }
      column = parsedRowGroup.columns.find((d) => d.meta_data!.path_in_schema.join(',') === path);

      if (!column) {
        throw new Error(`Column ${path} Not Found`);
      }
    } else {
      column = path;
    }
    return column;
  }

  getAllColumnChunkDataFor(paths: string[], row_groups?: RowGroupExt[]) {
    if (!row_groups) {
      row_groups = this.metadata!.row_groups;
    }

    return row_groups.flatMap((rowGroup, index) =>
      paths.map((columnName) => ({
        rowGroupIndex: index,
        column: this.getColumn(columnName, rowGroup),
      }))
    );
  }

  readOffsetIndex(
    path: string | ColumnChunkExt,
    row_group: RowGroupExt | number | null,
    opts: Options
  ): Promise<parquet_thrift.OffsetIndex> {
    const column = this.getColumn(path, row_group);
    if (column.offsetIndex) {
      return Promise.resolve(column.offsetIndex);
    } else if (!column.offset_index_offset || !column.offset_index_length) {
      return Promise.reject('Offset Index Missing');
    }

    const data = this.read(+column.offset_index_offset, column.offset_index_length).then((data: Buffer) => {
      const offset_index = new parquet_thrift.OffsetIndex();
      parquet_util.decodeThrift(offset_index, data);
      Object.defineProperty(offset_index, 'column', { value: column, enumerable: false });
      return offset_index;
    });
    if (opts?.cache) {
      column.offsetIndex = data;
    }
    return data;
  }

  readColumnIndex(
    path: string | ColumnChunkExt,
    row_group: RowGroupExt | number,
    opts: Options
  ): Promise<parquet_thrift.ColumnIndex> {
    const column = this.getColumn(path, row_group);
    if (column.columnIndex) {
      return Promise.resolve(column.columnIndex);
    } else if (!column.column_index_offset) {
      return Promise.reject(new Error('Column Index Missing'));
    }

    const data = this.read(+column.column_index_offset, column.column_index_length as number).then((buf: Buffer) => {
      const column_index = new parquet_thrift.ColumnIndex();
      parquet_util.decodeThrift(column_index, buf);
      Object.defineProperty(column_index, 'column', { value: column });

      // decode the statistics values
      const field = this.schema!.findField(column.meta_data!.path_in_schema);
      if (column_index.max_values) {
        column_index.max_values = column_index.max_values.map((max_value) => decodeStatisticsValue(max_value, field));
      }
      if (column_index.min_values) {
        column_index.min_values = column_index.min_values.map((min_value) => decodeStatisticsValue(min_value, field));
      }
      return column_index;
    });

    if (opts?.cache) {
      column.columnIndex = data;
    }
    return data;
  }

  async readPage(
    column: ColumnChunkExt,
    page: parquet_thrift.PageLocation | number,
    records: Record<string, unknown>[],
    opts: Options
  ) {
    column = Object.assign({}, column);
    column.meta_data = Object.assign({}, column.meta_data);

    if (page instanceof parquet_thrift.PageLocation && page.offset !== undefined) {
      if (isNaN(Number(page.offset)) || isNaN(page.compressed_page_size)) {
        throw Error('page offset and/or size missing');
      }
      column.meta_data.data_page_offset = parquet_util.cloneInteger(page.offset);
      column.meta_data.total_compressed_size = new Int64(page.compressed_page_size);
    } else {
      const offsetIndex = await this.readOffsetIndex(column, null, opts);
      column.meta_data.data_page_offset = parquet_util.cloneInteger(offsetIndex.page_locations[page as number].offset);
      column.meta_data.total_compressed_size = new Int64(
        offsetIndex.page_locations[page as number].compressed_page_size
      );
    }
    const chunk = await this.readColumnChunk(this.schema!, column);
    Object.defineProperty(chunk, 'column', { value: column });
    const data = {
      columnData: { [chunk.column!.meta_data!.path_in_schema.join(',')]: chunk },
    };

    return parquet_shredder.materializeRecords(this.schema!, data, records);
  }

  async readRowGroup(schema: parquet_schema.ParquetSchema, rowGroup: RowGroupExt, columnList: unknown[][]) {
    const buffer: parquet_shredder.RecordBuffer = {
      rowCount: +rowGroup.num_rows,
      columnData: {},
      pageRowCount: 0,
      pages: {},
    };

    for (const colChunk of rowGroup.columns) {
      const colMetadata = colChunk.meta_data;
      const colKey = colMetadata!.path_in_schema;

      if (columnList.length > 0 && parquet_util.fieldIndexOf(columnList, colKey) < 0) {
        continue;
      }

      buffer.columnData![colKey.join(',')] = await this.readColumnChunk(schema, colChunk);
    }

    return buffer;
  }

  async readColumnChunk(schema: parquet_schema.ParquetSchema, colChunk: ColumnChunkExt, opts?: Options) {
    const metadata = colChunk.meta_data!;
    const field = schema.findField(metadata.path_in_schema);
    const type = parquet_util.getThriftEnum(parquet_thrift.Type, metadata.type);

    const compression = parquet_util.getThriftEnum(parquet_thrift.CompressionCodec, metadata.codec);

    const pagesOffset = +metadata.data_page_offset;
    let pagesSize = +metadata.total_compressed_size;

    if (!colChunk.file_path) {
      pagesSize = Math.min((this.fileSize as number) - pagesOffset, +metadata.total_compressed_size);
    }

    opts = Object.assign({}, opts, {
      type: type,
      rLevelMax: field.rLevelMax,
      dLevelMax: field.dLevelMax,
      compression: compression,
      column: field,
      num_values: metadata.num_values,
      treatInt96AsTimestamp: this.treatInt96AsTimestamp,
    });

    // If this exists and is greater than zero then we need to have an offset
    if (metadata.dictionary_page_offset && +metadata.dictionary_page_offset > 0) {
      const offset: number = +metadata.dictionary_page_offset;
      const size = Math.min(+this.fileSize - offset, this.default_dictionary_size);

      await this.read(offset, size, colChunk.file_path).then(async (buffer: Buffer) => {
        await decodePage({ offset: 0, buffer, size: buffer.length }, opts!).then((dict) => {
          opts!.dictionary = opts!.dictionary || (dict.dictionary as number[]);
        });
      });
    }

    return this.read(pagesOffset, pagesSize, colChunk.file_path).then((pagesBuf: Buffer) =>
      decodePages(pagesBuf, opts!)
    );
  }

  async readFooter() {
    if (typeof this.fileSize === 'function') {
      this.fileSize = await this.fileSize();
    }

    const trailerLen = PARQUET_MAGIC.length + 4;

    const offset = (this.fileSize as number) - trailerLen;
    const trailerBuf = await this.read(offset, trailerLen);

    if (trailerBuf.subarray(4).toString() != PARQUET_MAGIC) {
      throw new Error('not a valid parquet file');
    }

    const metadataSize = trailerBuf.readUInt32LE(0);
    const metadataOffset = (this.fileSize as number) - metadataSize - trailerLen;
    if (metadataOffset < PARQUET_MAGIC.length) {
      throw new Error('invalid metadata size');
    }

    const metadataBuf = await this.read(metadataOffset, metadataSize);
    const metadata = new parquet_thrift.FileMetaData();
    parquet_util.decodeThrift(metadata, metadataBuf);
    return metadata;
  }
}

/**
 * Decode a consecutive array of data using one of the parquet encodings
 */
function decodeValues(
  type: string,
  encoding: ParquetCodec,
  cursor: Cursor,
  count: number,
  opts: Options | { bitWidth: number }
) {
  if (!(encoding in parquet_codec)) {
    throw new Error('invalid encoding: ' + encoding);
  }

  return parquet_codec[encoding].decodeValues(type, cursor, count, opts as Options);
}

function decodeStatisticsValue(value: any, column: ParquetField | Options) {
  if (value === null || !value.length) {
    return undefined;
  }
  if (!column.primitiveType!.includes('BYTE_ARRAY')) {
    value = decodeValues(
      column.originalType === 'DECIMAL' && ['INT32', 'INT64'].includes(column.primitiveType!)
        ? value.length === 4 ? 'INT32' : 'INT64'
        : column.primitiveType!,
      'PLAIN',
      { buffer: Buffer.from(value), offset: 0 },
      1,
      column as Options
    );
    if (value.length === 1) value = value[0];
  }

  if (column.originalType) {
    value = parquet_types.fromPrimitive(column.originalType, value, column);
  }
  return value;
}

function decodeStatistics(statistics: parquet_thrift.Statistics, column: ParquetField) {
  if (!statistics) {
    return;
  }
  if (statistics.min_value !== null) {
    statistics.min_value = decodeStatisticsValue(statistics.min_value, column);
  }
  if (statistics.max_value !== null) {
    statistics.max_value = decodeStatisticsValue(statistics.max_value, column);
  }

  statistics.min = decodeStatisticsValue(statistics.min, column) || statistics.min_value;
  statistics.max = decodeStatisticsValue(statistics.max, column) || statistics.max_value;

  return statistics;
}

async function decodePage(cursor: Cursor, opts: Options): Promise<PageData> {
  opts = opts || {};
  let page: PageData;
  const pageHeader = new NewPageHeader();

  const headerOffset = cursor.offset;
  const headerSize = parquet_util.decodeThrift(pageHeader, cursor.buffer.subarray(cursor.offset));
  cursor.offset += headerSize;

  const pageType = parquet_util.getThriftEnum(parquet_thrift.PageType, pageHeader.type);

  switch (pageType) {
    case 'DATA_PAGE':
      if (!opts.rawStatistics) {
        pageHeader.data_page_header!.statistics = decodeStatistics(
          pageHeader.data_page_header!.statistics!,
          opts.column!
        );
      }
      page = await decodeDataPage(cursor, pageHeader, opts);
      break;
    case 'DATA_PAGE_V2':
      if (!opts.rawStatistics) {
        pageHeader.data_page_header_v2!.statistics = decodeStatistics(
          pageHeader.data_page_header_v2!.statistics!,
          opts.column!
        );
      }
      page = await decodeDataPageV2(cursor, pageHeader, opts);
      break;
    case 'DICTIONARY_PAGE':
      page = {
        dictionary: await decodeDictionaryPage(cursor, pageHeader, opts),
      };
      break;
    default:
      throw new Error(`invalid page type: ${pageType}`);
  }

  pageHeader.offset = headerOffset;
  pageHeader.headerSize = headerSize;

  page.pageHeader = pageHeader;
  return page;
}

async function decodePages(buffer: Buffer, opts: Options) {
  opts = opts || {};
  const cursor = {
    buffer: buffer,
    offset: 0,
    size: buffer.length,
  };

  const data: PageData = {
    rlevels: [],
    dlevels: [],
    values: [],
    pageHeaders: [],
    count: 0,
  };

  while (cursor.offset < cursor.size && (!opts.num_values || data.dlevels!.length < opts.num_values)) {
    const pageData: PageData = await decodePage(cursor, opts);

    if (pageData.dictionary) {
      opts.dictionary = pageData.dictionary as number[];
      continue;
    }

    // It's possible to have a column chunk where some pages should use
    // the dictionary (PLAIN_DICTIONARY for example) and others should
    // not (PLAIN for example).

    if (opts.dictionary && pageData.useDictionary) {
      pageData.values = pageData.values!.map((d) => opts.dictionary![d]);
    }

    const length = pageData.rlevels != undefined ? pageData.rlevels.length : 0;

    for (let i = 0; i < length; i++) {
      data.rlevels!.push(pageData.rlevels![i]);
      data.dlevels!.push(pageData.dlevels![i]);
      const value = pageData.values![i];
      if (value !== undefined) {
        data.values!.push(value);
      }
    }
    data.count! += pageData.count!;
    data.pageHeaders!.push(pageData.pageHeader!);
  }

  return data;
}

async function decodeDictionaryPage(cursor: Cursor, header: parquet_thrift.PageHeader, opts: Options) {
  const cursorEnd = cursor.offset + header.compressed_page_size;

  let dictCursor = {
    offset: 0,
    buffer: cursor.buffer.subarray(cursor.offset, cursorEnd),
    size: cursorEnd - cursor.offset,
  };

  cursor.offset = cursorEnd;

  if (opts.compression && opts.compression !== 'UNCOMPRESSED') {
    const valuesBuf = await parquet_compression.inflate(
      opts.compression,
      dictCursor.buffer.subarray(dictCursor.offset, cursorEnd)
    );

    dictCursor = {
      buffer: valuesBuf,
      offset: 0,
      size: valuesBuf.length,
    };
  }

  return decodeValues(opts.type!, opts.column!.encoding!, dictCursor, header.dictionary_page_header!.num_values, {
    ...opts,
    ...opts.column,
  });
}

async function decodeDataPage(cursor: Cursor, header: parquet_thrift.PageHeader, opts: Options) {
  const cursorEnd = cursor.offset + header.compressed_page_size;

  const dataPageHeader = header.data_page_header!;

  const valueCount = dataPageHeader.num_values;
  const valueEncoding = parquet_util.getThriftEnum(parquet_thrift.Encoding, dataPageHeader.encoding);

  let valuesBufCursor = cursor;
  if (opts.compression && opts.compression !== 'UNCOMPRESSED') {
    const valuesBuf = await parquet_compression.inflate(
      opts.compression,
      cursor.buffer.subarray(cursor.offset, cursorEnd)
    );

    valuesBufCursor = {
      buffer: valuesBuf,
      offset: 0,
      size: valuesBuf.length,
    };
  }

  /* read repetition levels */
  const rLevelEncoding = parquet_util.getThriftEnum(parquet_thrift.Encoding, dataPageHeader.repetition_level_encoding);

  let rLevels = new Array(valueCount);
  if (opts.rLevelMax! > 0) {
    rLevels = decodeValues(PARQUET_RDLVL_TYPE, rLevelEncoding as ParquetCodec, valuesBufCursor, valueCount, {
      bitWidth: parquet_util.getBitWidth(opts.rLevelMax!),
    });
  } else {
    rLevels.fill(0);
  }

  /* read definition levels */
  const dLevelEncoding = parquet_util.getThriftEnum(parquet_thrift.Encoding, dataPageHeader.definition_level_encoding);

  let dLevels = new Array(valueCount);
  if (opts.dLevelMax! > 0) {
    dLevels = decodeValues(PARQUET_RDLVL_TYPE, dLevelEncoding as ParquetCodec, valuesBufCursor, valueCount, {
      bitWidth: parquet_util.getBitWidth(opts.dLevelMax!),
    });
  } else {
    dLevels.fill(0);
  }

  /* read values */
  let valueCountNonNull = 0;
  for (const dlvl of dLevels) {
    if (dlvl === opts.dLevelMax) {
      ++valueCountNonNull;
    }
  }

  const values = decodeValues(opts.type!, valueEncoding as ParquetCodec, valuesBufCursor, valueCountNonNull, {
    typeLength: opts.column!.typeLength!,
    bitWidth: opts.column!.typeLength!,
    disableEnvelope: opts.column!.disableEnvelope,
    originalType: opts.column!.originalType,
    precision: opts.column!.precision,
    scale: opts.column!.scale,
    name: opts.column!.name,
    treatInt96AsTimestamp: opts.treatInt96AsTimestamp,
  });

  cursor.offset = cursorEnd;

  return {
    dlevels: dLevels,
    rlevels: rLevels,
    values: values,
    count: valueCount,
    useDictionary: valueEncoding === 'PLAIN_DICTIONARY' || valueEncoding === 'RLE_DICTIONARY',
  };
}

async function decodeDataPageV2(cursor: Cursor, header: parquet_thrift.PageHeader, opts: Options) {
  const cursorEnd = cursor.offset + header.compressed_page_size;
  const dataPageHeaderV2 = header.data_page_header_v2!;

  const valueCount = dataPageHeaderV2.num_values;
  const valueCountNonNull = valueCount - dataPageHeaderV2.num_nulls;
  const valueEncoding = parquet_util.getThriftEnum(parquet_thrift.Encoding, dataPageHeaderV2.encoding);

  /* read repetition levels */
  let rLevels = new Array(valueCount);
  if (opts.rLevelMax! > 0) {
    rLevels = decodeValues(PARQUET_RDLVL_TYPE, PARQUET_RDLVL_ENCODING, cursor, valueCount, {
      bitWidth: parquet_util.getBitWidth(opts.rLevelMax!),
      disableEnvelope: true,
    });
  } else {
    rLevels.fill(0);
  }

  /* read definition levels */
  let dLevels = new Array(valueCount);
  if (opts.dLevelMax! > 0) {
    dLevels = decodeValues(PARQUET_RDLVL_TYPE, PARQUET_RDLVL_ENCODING, cursor, valueCount, {
      bitWidth: parquet_util.getBitWidth(opts.dLevelMax!),
      disableEnvelope: true,
    });
  } else {
    dLevels.fill(0);
  }

  /* read values */
  let valuesBufCursor = cursor;

  if (dataPageHeaderV2.is_compressed) {
    const valuesBuf = await parquet_compression.inflate(
      opts.compression!,
      cursor.buffer.subarray(cursor.offset, cursorEnd)
    );

    valuesBufCursor = {
      buffer: valuesBuf,
      offset: 0,
      size: valuesBuf.length,
    };

    cursor.offset = cursorEnd;
  }

  const values = decodeValues(opts.type!, valueEncoding as ParquetCodec, valuesBufCursor, valueCountNonNull, {
    bitWidth: opts.column!.typeLength!,
    treatInt96AsTimestamp: opts.treatInt96AsTimestamp,
    ...opts.column!,
  });

  return {
    dlevels: dLevels,
    rlevels: rLevels,
    values: values,
    count: valueCount,
    useDictionary: valueEncoding === 'PLAIN_DICTIONARY' || valueEncoding === 'RLE_DICTIONARY',
  };
}

function decodeSchema(schemaElements: parquet_thrift.SchemaElement[]) {
  let schema: SchemaDefinition | FieldDefinition = {};
  schemaElements.forEach((schemaElement) => {
    const repetitionType = parquet_util.getThriftEnum(
      parquet_thrift.FieldRepetitionType,
      schemaElement.repetition_type
    );

    let optional = false;
    let repeated = false;
    switch (repetitionType) {
      case 'REQUIRED':
        break;
      case 'OPTIONAL':
        optional = true;
        break;
      case 'REPEATED':
        repeated = true;
        break;
    }

    if (schemaElement.num_children != undefined && schemaElement.num_children > 0) {
      (schema as SchemaDefinition)[schemaElement.name] = {
        optional: optional,
        repeated: repeated,
        fields: Object.create(
          {},
          {
            /* define parent and num_children as non-enumerable */
            parent: {
              value: schema,
              enumerable: false,
            },
            num_children: {
              value: schemaElement.num_children,
              enumerable: false,
            },
          }
        ),
      };
      /* move the schema pointer to the children */
      schema = (schema as SchemaDefinition)[schemaElement.name].fields as SchemaDefinition;
    } else {
      let logicalType = parquet_util.getThriftEnum(parquet_thrift.Type, schemaElement.type);

      if (schemaElement.converted_type != null) {
        logicalType = parquet_util.getThriftEnum(parquet_thrift.ConvertedType, schemaElement.converted_type);
      }

      (schema as SchemaDefinition)[schemaElement.name] = {
        type: logicalType as ParquetType,
        typeLength: schemaElement.type_length,
        optional: optional,
        repeated: repeated,
        scale: schemaElement.scale,
        precision: schemaElement.precision,
      };
    }

    /* if we have processed all children we move schema pointer to parent again */
    while (schema.parent && Object.keys(schema).length === schema.num_children) {
      schema = schema.parent as FieldDefinition;
    }
  });
  return schema;
}
