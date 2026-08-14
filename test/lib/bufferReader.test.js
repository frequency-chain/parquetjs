import { use, expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import sinonChaiInOrder from '../util/sinon-chai-in-order';
import BufferReader from '../../lib/bufferReader';
import { ParquetEnvelopeReader } from '../../lib/reader';

use(sinonChai);
use(sinonChaiInOrder);

describe('bufferReader', function () {
  let reader;

  beforeEach(function () {
    const mockEnvelopeReader = sinon.fake();
    reader = new BufferReader(mockEnvelopeReader, {});
  });

  describe('#read', function () {
    describe('given that reader is scheduled', function () {
      it('adds an item to the queue', function () {
        const offset = 1;
        const length = 2;
        reader.read(offset, length);
        expect(reader.queue.length).to.eql(1);
      });
    });
  });

  describe('#processQueue', function () {
    it('only enqueues an item and reads on flushing the queue', async function () {
      const mockResolve = sinon.spy();
      const mockResolve2 = sinon.spy();
      reader.envelopeReader = { readFn: sinon.fake.returns(Buffer.from('buffer', 'utf8')) };

      reader.queue = [
        {
          offset: 1,
          length: 1,
          resolve: mockResolve,
        },
        {
          offset: 2,
          length: 4,
          resolve: mockResolve2,
        },
      ];

      await reader.processQueue();

      sinon.assert.calledWith(mockResolve, Buffer.from('b', 'utf8'));
      sinon.assert.calledWith(mockResolve2, Buffer.from('uffe', 'utf8'));
    });

    it('enqueues items and then reads them', async function () {
      const mockResolve = sinon.spy();
      const mockResolve2 = sinon.spy();
      reader.maxLength = 1;
      reader.envelopeReader = { readFn: sinon.fake.returns(Buffer.from('buffer', 'utf8')) };

      reader.queue = [
        {
          offset: 1,
          length: 1,
          resolve: mockResolve,
        },
        {
          offset: 2,
          length: 4,
          resolve: mockResolve2,
        },
      ];

      await reader.processQueue();

      sinon.assert.calledWith(mockResolve, Buffer.from('b', 'utf8'));
      sinon.assert.calledWith(mockResolve2, Buffer.from('uffe', 'utf8'));
    });

    it('enqueues items and reads them in order', async function () {
      const mockResolve = sinon.spy();
      reader.envelopeReader = { readFn: sinon.fake.returns(Buffer.from('thisisalargebuffer', 'utf8')) };

      reader.queue = [
        {
          offset: 1,
          length: 4,
          resolve: mockResolve,
        },
        {
          offset: 5,
          length: 2,
          resolve: mockResolve,
        },
        {
          offset: 7,
          length: 1,
          resolve: mockResolve,
        },
        {
          offset: 8,
          length: 5,
          resolve: mockResolve,
        },
        {
          offset: 13,
          length: 6,
          resolve: mockResolve,
        },
      ];

      await reader.processQueue();

      expect(mockResolve)
        .inOrder.to.have.been.calledWith(Buffer.from('this', 'utf8'))
        .subsequently.calledWith(Buffer.from('is', 'utf8'))
        .subsequently.calledWith(Buffer.from('a', 'utf8'))
        .subsequently.calledWith(Buffer.from('large', 'utf8'))
        .subsequently.calledWith(Buffer.from('buffer', 'utf8'));
    });

    it('should read even if the maxSpan has been exceeded', async function () {
      const mockResolve = sinon.spy();
      reader.maxSpan = 5;
      reader.envelopeReader = { readFn: sinon.fake.returns(Buffer.from('willslicefrombeginning', 'utf8')) };

      reader.queue = [
        {
          offset: 1,
          length: 4,
          resolve: mockResolve,
        },
        {
          offset: 10,
          length: 4,
          resolve: mockResolve,
        },
        {
          offset: 10,
          length: 9,
          resolve: mockResolve,
        },
        {
          offset: 10,
          length: 13,
          resolve: mockResolve,
        },
        {
          offset: 10,
          length: 22,
          resolve: mockResolve,
        },
      ];

      await reader.processQueue();

      expect(mockResolve)
        .inOrder.to.have.been.calledWith(Buffer.from('will', 'utf8'))
        .subsequently.calledWith(Buffer.from('will', 'utf8'))
        .subsequently.calledWith(Buffer.from('willslice', 'utf8'))
        .subsequently.calledWith(Buffer.from('willslicefrom', 'utf8'))
        .subsequently.calledWith(Buffer.from('willslicefrombeginning', 'utf8'));
    });
  });
});

describe('bufferReader Integration Tests', function () {
  let reader;
  let envelopeReader;

  describe('Reading a file', function () {
    beforeEach(async function () {
      envelopeReader = await ParquetEnvelopeReader.openFile('./test/lib/test.txt', {});
      reader = new BufferReader(envelopeReader);
    });

    it('should properly read the file', async function () {
      const buffer = await reader.read(0, 5);
      const buffer2 = await reader.read(6, 5);
      const buffer3 = await reader.read(12, 5);

      expect(buffer).to.eql(Buffer.from('Lorem'));
      expect(buffer2).to.eql(Buffer.from('ipsum'));
      expect(buffer3).to.eql(Buffer.from('dolor'));
    });
  });
});
