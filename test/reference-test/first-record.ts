import { unsupported } from './read-all.test';

/**
 * Helper function to return the data for the first row of a parquet file
 *
 * If the first row has been manually parsed, returns [true, data]
 * If the data has not been manually parsed returns [false, null]
 */
export function getFirstRecord(filename: string): [true, any] | [false, null] {
  switch (filename) {
    case 'alltypes_dictionary.parquet':
      return [
        true,
        {
          bigint_col: 0n,
          bool_col: true,
          date_string_col: Buffer.from('01/01/09'),
          double_col: 0,
          float_col: 0,
          id: 0,
          int_col: 0,
          smallint_col: 0,
          string_col: Buffer.from('0'),
          timestamp_col: 0,
          tinyint_col: 0,
        },
      ];
    case 'alltypes_plain.parquet':
      return [
        true,
        {
          bigint_col: 0n,
          bool_col: true,
          date_string_col: Buffer.from('03/01/09'),
          double_col: 0,
          float_col: 0,
          id: 4,
          int_col: 0,
          smallint_col: 0,
          string_col: Buffer.from('0'),
          timestamp_col: 0,
          tinyint_col: 0,
        },
      ];
    case 'alltypes_plain.snappy.parquet':
      return [
        true,
        {
          bigint_col: 0n,
          bool_col: true,
          date_string_col: Buffer.from('04/01/09'),
          double_col: 0,
          float_col: 0,
          id: 6,
          int_col: 0,
          smallint_col: 0,
          string_col: Buffer.from('0'),
          timestamp_col: 0,
          tinyint_col: 0,
        },
      ];
    case 'nan_in_stats.parquet':
      return [true, { x: 1 }];
    case 'alltypes_tiny_pages.parquet':
      return [
        true,
        {
          bigint_col: 20n,
          bool_col: true,
          date_string_col: '01/13/09',
          double_col: 20.2,
          float_col: 2.200000047683716,
          id: 122,
          int_col: 2,
          month: 1,
          smallint_col: 2,
          string_col: '2',
          timestamp_col: 3725410000000,
          tinyint_col: 2,
          year: 2009,
        },
      ];
    case 'alltypes_tiny_pages_plain.parquet':
      return [
        true,
        {
          bigint_col: 20n,
          bool_col: true,
          date_string_col: '01/13/09',
          double_col: 20.2,
          float_col: 2.200000047683716,
          id: 122,
          int_col: 2,
          month: 1,
          smallint_col: 2,
          string_col: '2',
          timestamp_col: 3725410000000,
          tinyint_col: 2,
          year: 2009,
        },
      ];
    case 'binary.parquet':
      return [
        true,
        {
          foo: Buffer.from([0]),
        },
      ];
    case 'byte_array_decimal.parquet':
      return [
        true,
        {
          value: Buffer.from([100]),
        },
      ];
    case 'concatenated_gzip_members.parquet':
      return [
        true,
        {
          long_col: 1n,
        },
      ];
    case 'data_index_bloom_encoding_stats.parquet':
      return [
        true,
        {
          String: 'Hello',
        },
      ];
    case 'data_index_bloom_encoding_with_length.parquet':
      return [
        true,
        {
          String: 'Hello',
        },
      ];
    case 'datapage_v1-corrupt-checksum.parquet':
      return [true, { a: 50462976, b: 1734763876 }];
    case 'datapage_v1-snappy-compressed-checksum.parquet':
      return [true, { a: 50462976, b: 1734763876 }];
    case 'datapage_v1-uncompressed-checksum.parquet':
      return [true, { a: 50462976, b: 1734763876 }];
    case 'dict-page-offset-zero.parquet':
      return [
        true,
        {
          l_partkey: 1552,
        },
      ];
    case 'fixed_length_byte_array.parquet':
      return [
        true,
        {
          flba_field: Buffer.from([0, 0, 3, 232]),
        },
      ];
    case 'fixed_length_decimal.parquet':
      return [
        true,
        {
          value: Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100]),
        },
      ];
    case 'fixed_length_decimal_legacy.parquet':
      return [
        true,
        {
          value: Buffer.from([0, 0, 0, 0, 0, 100]),
        },
      ];
    case 'float16_nonzeros_and_nans.parquet':
      return [
        true,
        {
          x: null,
        },
      ];
    case 'float16_zeros_and_nans.parquet':
      return [
        true,
        {
          x: null,
        },
      ];
    case 'int32_decimal.parquet':
      return [
        true,
        {
          value: 1,
        },
      ];
    case 'int32_with_null_pages.parquet':
      return [
        true,
        {
          int32_field: -654807448,
        },
      ];
    case 'int64_decimal.parquet':
      return [
        true,
        {
          value: 1,
        },
      ];
    case 'list_columns.parquet':
      return [
        true,
        {
          int64_list: {
            list: [{ item: 1n }, { item: 2n }, { item: 3n }],
          },
          utf8_list: {
            list: [{ item: 'abc' }, { item: 'efg' }, { item: 'hij' }],
          },
        },
      ];
    case 'nation.dict-malformed.parquet':
      return [
        true,
        {
          comment_col: Buffer.from(' haggle. carefully final deposits detect slyly agai'),
          name: Buffer.from('ALGERIA'),
          nation_key: 0,
          region_key: 0,
        },
      ];
    case 'nested_maps.snappy.parquet':
      return [
        true,
        {
          a: {
            key_value: [
              {
                key: 'a',
                value: {
                  key_value: [
                    {
                      key: 1,
                      value: true,
                    },
                    {
                      key: 2,
                      value: false,
                    },
                  ],
                },
              },
            ],
          },
          b: 1,
          c: 1,
        },
      ];
    case 'nested_lists.snappy.parquet':
      return [
        true,
        {
          a: {
            list: [
              {
                element: {
                  list: [
                    {
                      element: {
                        list: [
                          {
                            element: 'a',
                          },
                          {
                            element: 'b',
                          },
                        ],
                      },
                    },
                    {
                      element: {
                        list: [
                          {
                            element: 'c',
                          },
                        ],
                      },
                    },
                  ],
                },
              },
              {
                element: {
                  list: [
                    {
                      element: null,
                    },
                    {
                      element: {
                        list: [
                          {
                            element: 'd',
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
          b: 1,
        },
      ];
    case 'nonnullable.impala.parquet':
      return [
        true,
        {
          ID: 8n,
          Int_Array: {
            list: [
              {
                element: -1,
              },
            ],
          },
          Int_Map: {
            map: [
              {
                key: 'k1',
                value: -1,
              },
            ],
          },
          int_array_array: {
            list: [
              {
                element: {
                  list: [
                    {
                      element: -1,
                    },
                    {
                      element: -2,
                    },
                  ],
                },
              },
              {
                element: {
                  list: null,
                },
              },
            ],
          },
          int_map_array: {
            list: [
              {
                element: {
                  map: null,
                },
              },
              {
                element: {
                  map: [
                    {
                      key: 'k1',
                      value: 1,
                    },
                  ],
                },
              },
              {
                element: {
                  map: null,
                },
              },
              {
                element: {
                  map: null,
                },
              },
            ],
          },
          nested_Struct: {
            B: {
              list: [
                {
                  element: -1,
                },
              ],
            },
            G: {
              map: null,
            },
            a: -1,
            c: {
              D: {
                list: [
                  {
                    element: {
                      list: [
                        {
                          element: {
                            e: -1,
                            f: 'nonnullable',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ];
    case 'null_list.parquet':
      return [
        true,
        {
          emptylist: {
            list: null,
          },
        },
      ];
    case 'nullable.impala.parquet':
      return [
        true,
        {
          id: 1n,
          int_Map_Array: {
            list: [
              {
                element: {
                  map: [
                    {
                      key: 'k1',
                      value: 1,
                    },
                  ],
                },
              },
            ],
          },
          int_array: {
            list: [
              {
                element: 1,
              },
              {
                element: 2,
              },
              {
                element: 3,
              },
            ],
          },
          int_array_Array: {
            list: [
              {
                element: {
                  list: [
                    {
                      element: 1,
                    },
                    {
                      element: 2,
                    },
                  ],
                },
              },
              {
                element: {
                  list: [
                    {
                      element: 3,
                    },
                    {
                      element: 4,
                    },
                  ],
                },
              },
            ],
          },
          int_map: {
            map: [
              {
                key: 'k1',
                value: 1,
              },
              {
                key: 'k2',
                value: 100,
              },
            ],
          },
          nested_struct: {
            A: 1,
            C: {
              d: {
                list: [
                  {
                    element: {
                      list: [
                        {
                          element: {
                            E: 10,
                            F: 'aaa',
                          },
                        },
                        {
                          element: {
                            E: -10,
                            F: 'bbb',
                          },
                        },
                      ],
                    },
                  },
                  {
                    element: {
                      list: [
                        {
                          element: {
                            E: 11,
                            F: 'c',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            b: {
              list: [
                {
                  element: 1,
                },
              ],
            },
            g: {
              map: [
                {
                  key: 'foo',
                  value: {
                    H: {
                      i: {
                        list: [
                          {
                            element: 1.1,
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      ];
    case 'nulls.snappy.parquet':
      return [
        true,
        {
          b_struct: {
            b_c_int: null,
          },
        },
      ];
    case 'overflow_i16_page_cnt.parquet':
      return [
        true,
        {
          inc: false,
        },
      ];
    case 'plain-dict-uncompressed-checksum.parquet':
      return [
        true,
        {
          binary_field: Buffer.from('a655fd0e-9949-4059-bcae-fd6a002a4652'),
          long_field: 0n,
        },
      ];
    case 'repeated_no_annotation.parquet':
      return [
        true,
        {
          id: 1,
          phoneNumbers: null,
        },
      ];
    case 'rle-dict-snappy-checksum.parquet':
      return [
        true,
        {
          binary_field: Buffer.from('c95e263a-f5d4-401f-8107-5ca7146a1f98'),
          long_field: 0n,
        },
      ];
    case 'rle-dict-uncompressed-corrupt-checksum.parquet':
      return [
        true,
        {
          binary_field: Buffer.from('6325c32b-f417-41aa-9e02-9b8601542aff'),
          long_field: 0n,
        },
      ];
    case 'single_nan.parquet':
      return [
        true,
        {
          mycol: null,
        },
      ];
    // confirm that the parquetjs implementation correctly decodes the BYTE_STREAM_SPLIT
    // encoding and ZSTD compression, matching the output produced by the PyArrow
    // reference implementation.
    // f32: 1.764052391052246 = the first value generated by np.random.normal() when the
    // seed is set to 0. It is the first element of the f32 column.
    // f64: -1.3065268517353166  is the 301st value generated in the same random
    // sequence. Since the first 300 values were consumed by the f32 column, the f64
    // column starts with the 301st value.
    case 'byte_stream_split.zstd.parquet':
      return [
        true,
        {
          f32: 1.764052391052246,
          f64: -1.3065268517353166,
        },
      ];
    case 'bson.parquet':
      return [
        true,
         {"a":1}
      ];
    case 'json.parquet':
      return [ true, { json_field: { a: 1 }}];
    // Not supported - see read-all-test.ts
    // case ("datapage_v2.snappy.parquet"):
    // case ("delta_binary_packed.parquet"):
    // case ("delta_byte_array.parquet"):
    // case ("delta_encoding_optional_column.parquet"):
    // case ("delta_encoding_required_column.parquet"):
    // case ("delta_length_byte_array.parquet"):
    // case ("hadoop_lz4_compressed.parquet"):
    // case ("hadoop_lz4_compressed_larger.parquet"):
    // case ("large_string_map.brotli.parquet"):
    // case ("lz4_raw_compressed.parquet"):
    // case ("lz4_raw_compressed_larger.parquet"):
    // case ("nested_structs.rust.parquet"):
    // case ("non_hadoop_lz4_compressed.parquet"):
    // case ("rle_boolean_encoding.parquet"):
    default: {
      if (!unsupported.includes(filename)) {
        return [true, 'Please provide the first row of the parquet file for comparison'];
      }
      return [false, null];
    }
  }
}
