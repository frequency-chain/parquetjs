# Overview
1. Read README.md and package.json to understand the purpose of this package and its tech stack.
2. Read .tool-versions for the node version.
3. Test data files are *.parquet files throughout the repository.

# Rules
1. New packages must be pinned to exact versions.
2. A new feature is not considered complete unless it includes corresponding unit tests that prove the correct functioning of the feature, including error cases.
3. A bug fix is not considered complete unless it includes a regression test that proves the bug no longer occurs.
4. New encoding, compression, type support require:
    * both reading and writing for same be supported, 
    * unit tests demonstrating successful read and write utilizing the new encoding/compression/type.
    * builds for both browser and node succeed
