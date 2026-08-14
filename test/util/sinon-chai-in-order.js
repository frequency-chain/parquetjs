export default function sinonChaiInOrder(chai, utils) {
  chai.Assertion.addProperty('inOrder', function () {
    if (!isSpy(this._obj)) {
      throw new TypeError(utils.inspect(this._obj) + ' is not a spy!');
    } else {
      const context = new Context(this._obj);
      utils.flag(this, 'inOrderContext', context);

      return next(this, context);
    }
  });

  chai.Assertion.overwriteProperty('subsequently', function (_super) {
    return function () {
      const context = utils.flag(this, 'inOrderContext');
      if (context) {
        this.assert(context.hasNext(), `spy was only called ${context.callCount()} time(s)`);

        return next(this, context);
      } else {
        _super.call(this);
      }
    };
  });

  function next(assertion, context) {
    const next = new chai.Assertion(context.next());
    utils.transferFlags(assertion, next, false);
    return next;
  }
}

function isSpy(putativeSpy) {
  return (
    typeof putativeSpy === 'function' &&
    typeof putativeSpy.getCall === 'function' &&
    typeof putativeSpy.calledWithExactly === 'function'
  );
}

class Context {
  constructor(spy) {
    this.spy = spy;
    this._currentCall = 0;
  }

  next() {
    return this.spy.getCall(this._currentCall++);
  }

  hasNext() {
    return this.callCount() > this._currentCall;
  }

  callCount() {
    return this.spy.callCount;
  }
}
