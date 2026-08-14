import sinon from 'sinon';
import { use, expect } from 'chai';
import sinonChaiInOrder from '../util/sinon-chai-in-order';
import sc from 'sinon-chai';
use(sinonChaiInOrder);
use(sc);

describe('.inOrder', function () {
  it('Asserts the order of calls', function () {
    const spy = sinon.spy();
    [1, 2, 3].forEach(spy);

    expect(() => {
      expect(spy).inOrder.to.have.been.calledWith(1).subsequently.calledWith(2).subsequently.calledWith(3);
    }).not.to.throw();
  });

  it('fails when assertion order is incorrect', function () {
    const spy = sinon.spy();
    [1, 2, 3].forEach(spy);

    expect(() => {
      expect(spy).inOrder.to.have.been.calledWith(1).subsequently.calledWith(3).subsequently.calledWith(2);
    }).to.throw('expected spy to have been called with arguments 3');
  });

  it('fails when asserted object is not a spy', function () {
    expect(() => {
      expect('foo').inOrder;
    }).to.throw(`'foo' is not a spy!`);
  });
});

describe('.subsequently', function () {
  it('does nothing if asserted object is not a spy call', function () {
    const obj = 'obj';
    expect(expect(obj).subsequently).to.have.property('_obj').that.equals(obj);
  });

  it('fails if no spy call was found', function () {
    const spy = sinon.spy();
    spy(1);

    expect(() => {
      expect(spy).inOrder.to.have.been.calledWith(1).subsequently.calledWith(2);
    }).to.throw('spy was only called 1 time(s)');
  });
});
