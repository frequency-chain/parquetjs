// Thanks to https://github.com/kbajalc/parquets

import parquet_thrift, { LogicalType } from '../gen-nodejs/parquet_types';
import {
  Statistics,
  OffsetIndex,
  ColumnIndex,
  PageType,
  DataPageHeader,
  DataPageHeaderV2,
  DictionaryPageHeader,
  IndexPageHeader,
} from '../gen-nodejs/parquet_types';
import SplitBlockBloomFilter from './bloom/sbbf';
import { createSBBFParams } from './bloomFilterIO/bloomFilterWriter';
import Int64 from 'node-int64';

export type ParquetCodec = 'PLAIN' | 'RLE' | 'PLAIN_DICTIONARY' | 'RLE_DICTIONARY' | 'BYTE_STREAM_SPLIT';

// Currently LZO and LZ4 are not supported
export type ParquetCompression = 'UNCOMPRESSED' | 'GZIP' | 'SNAPPY' | 'LZO' | 'BROTLI' | 'LZ4' | 'ZSTD';

export type RepetitionType = 'REQUIRED' | 'OPTIONAL' | 'REPEATED';
export type ParquetType = PrimitiveType | OriginalType;

export type PrimitiveType =
  // Base Types
  | 'BOOLEAN' // 0
  | 'INT32' // 1
  | 'INT64' // 2
  | 'INT96' // 3
  | 'FLOAT' // 4
  | 'DOUBLE' // 5
  | 'BYTE_ARRAY' // 6,
  | 'FIXED_LEN_BYTE_ARRAY'; // 7

export type OriginalType =
  // Converted Types
  | 'UTF8' // 0
  | 'MAP' // 1
  // | 'MAP_KEY_VALUE' // 2
  | 'LIST' // 3
  | 'ENUM' // 4
  | 'DECIMAL' // 5
  | 'DATE' // 6
  | 'TIME_MILLIS' // 7
  | 'TIME_MICROS' // 8
  | 'TIMESTAMP_MILLIS' // 9
  | 'TIMESTAMP_MICROS' // 10
  | 'UINT_8' // 11
  | 'UINT_16' // 12
  | 'UINT_32' // 13
  | 'UINT_64' // 14
  | 'INT_8' // 15
  | 'INT_16' // 16
  | 'INT_32' // 17
  | 'INT_64' // 18
  | 'JSON' // 19
  | 'BSON' // 20
  | 'INTERVAL'; // 21

export type SchemaDefinition = Record<string, FieldDefinition>;

export interface FieldDefinition {
  type?: ParquetType;
  typeLength?: number;
  logicalType?: LogicalType;
  encoding?: ParquetCodec;
  compression?: ParquetCompression;
  optional?: boolean;
  repeated?: boolean;
  fields?: SchemaDefinition;
  statistics?: Statistics | false;
  parent?: ParentField;
  num_children?: NumChildrenField;
  precision?: number;
  scale?: number;
}

export interface ParquetField {
  name: string;
  path: string[];
  statistics?: Statistics | false;
  primitiveType?: PrimitiveType;
  originalType?: OriginalType;
  repetitionType: RepetitionType;
  logicalType?: LogicalType;
  typeLength?: number;
  encoding?: ParquetCodec;
  compression?: ParquetCompression;
  precision?: number;
  scale?: number;
  rLevelMax: number;
  dLevelMax: number;
  isNested?: boolean;
  fieldCount?: number;
  fields?: Record<string, ParquetField>;
  disableEnvelope?: boolean;
}

interface ParentField {
  value: SchemaDefinition;
  enumerable: boolean;
}

interface NumChildrenField {
  value: number;
  enumerable: boolean;
}

export interface ParquetBuffer {
  rowCount?: number;
  columnData?: Record<string, PageData>;
}

export type ParquetRecord = Record<string, any>;

export interface ColumnChunkData {
  rowGroupIndex: number;
  column: parquet_thrift.ColumnChunk;
}

export interface ColumnChunkExt extends parquet_thrift.ColumnChunk {
  meta_data?: ColumnMetaDataExt;
  columnIndex?: ColumnIndex | Promise<ColumnIndex>;
  offsetIndex?: OffsetIndex | Promise<OffsetIndex>;
}
export interface ColumnMetaDataExt extends parquet_thrift.ColumnMetaData {
  offsetIndex?: OffsetIndex;
  columnIndex?: ColumnIndex;
}

export interface RowGroupExt extends parquet_thrift.RowGroup {
  columns: ColumnChunkExt[];
}

export declare class KeyValue {
  key: string;
  value?: string;
}

export type Block = Uint32Array;

export interface BloomFilterData {
  sbbf: SplitBlockBloomFilter;
  columnName: string;
  RowGroupIndex: number;
}

export interface Parameter {
  url: string;
  headers?: string;
}

export interface PageData {
  rlevels?: number[];
  dlevels?: number[];
  distinct_values?: Set<any>;
  values?: number[];
  pageHeaders?: PageHeader[];
  pageHeader?: PageHeader;
  count?: number;
  dictionary?: unknown[];
  column?: parquet_thrift.ColumnChunk;
  useDictionary?: boolean;
}

export declare class PageHeader {
  type: PageType;
  uncompressed_page_size: number;
  compressed_page_size: number;
  crc?: number;
  data_page_header?: DataPageHeader;
  index_page_header?: IndexPageHeader;
  dictionary_page_header?: DictionaryPageHeader;
  data_page_header_v2?: DataPageHeaderV2;
  offset?: number;
  headerSize?: number;

  constructor(args?: {
    type: PageType;
    uncompressed_page_size: number;
    compressed_page_size: number;
    crc?: number;
    data_page_header?: DataPageHeader;
    index_page_header?: IndexPageHeader;
    dictionary_page_header?: DictionaryPageHeader;
    data_page_header_v2?: DataPageHeaderV2;
  });
}

export interface ClientParameters {
  Bucket: string;
  Key: string;
}

export interface PromiseS3 {
  promise: () => Promise<any>;
}

export interface ClientS3 {
  accessKeyId: string;
  secretAccessKey: string;
  headObject: (params: ClientParameters) => PromiseS3;
  getObject: (args: any) => PromiseS3;
}

export interface FileMetaDataExt extends parquet_thrift.FileMetaData {
  json?: JSON;
  row_groups: RowGroupExt[];
}

export class NewPageHeader extends parquet_thrift.PageHeader {
  offset?: number;
  headerSize?: number;
}

export interface BufferReaderOptions {
  default_dictionary_size?: number;
  maxLength?: number;
  maxSpan?: number;
  queueWait?: number;
  metadata?: FileMetaDataExt;
  cache?: boolean;
  rawStatistics?: boolean;
  treatInt96AsTimestamp?: boolean; // Default to false for backward compatibility
}

export interface WriterOptions {
  pageIndex?: boolean;
  pageSize?: number;
  useDataPageV2?: boolean;
  bloomFilters?: createSBBFParams[];
  baseOffset?: Int64;
  rowGroupSize?: number;
  flags?: string;
  encoding?: BufferEncoding;
  fd?: number;
  mode?: number;
  autoClose?: boolean;
  emitClose?: boolean;
  start?: number;
  highWaterMark?: number;
}

export interface Page {
  page: Buffer;
  statistics: parquet_thrift.Statistics;
  first_row_index: number;
  distinct_values: Set<any>;
  num_values: number;
  count?: number;
}
