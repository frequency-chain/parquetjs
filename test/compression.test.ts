import { assert } from 'chai';
import sinon from 'sinon';
import zlib from 'zlib';
import { deflate, inflate } from '../lib/compression';

describe('compression', function () {
  afterEach(function () {
    sinon.restore();
  });

  it('performs GZIP operations without synchronous zlib calls', async function () {
    const gzipSyncSpy = sinon.spy(zlib, 'gzipSync');
    const gunzipSyncSpy = sinon.spy(zlib, 'gunzipSync');
    const input = Buffer.from('parquet data '.repeat(100));

    const compressed = await deflate('GZIP', input);
    const decompressed = await inflate('GZIP', compressed);

    assert.deepEqual(decompressed, input);
    sinon.assert.notCalled(gzipSyncSpy);
    sinon.assert.notCalled(gunzipSyncSpy);
  });
});
