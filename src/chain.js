const _ = require('lodash');
const t = require('tcomb');
const { PositiveInteger } = require('./types');

class ErrorInvalidCode extends Error {
  constructor(code) {
    super(`invalid code ${code}`);
  }
}

const allCodes = new Set();

const isValid = (code) =>
  allCodes.has(code);

class CodeGroup {
  constructor(properties) {
    // check type
    properties = t.dict(t.String, PositiveInteger)(properties);
    Object.assign(this, properties);
    const values = _.values(properties);
    if (new Set(values).size !== values.length) {
      throw new Error(`duplicate code`);
    }
    values.sort((a, b) => a - b);
    this.values = Object.freeze(values);
    this.values.forEach(allCodes.add.bind(allCodes));
    Object.freeze(this);
  }

  static byAddressType(p2sh, p2shP2wsh, p2wsh) {
    return new CodeGroup({ p2sh, p2shP2wsh, p2wsh });
  }

  static byDirection(internal, external, key) {
    return new CodeGroup({
      internal: internal[key],
      external: external[key]
    });
  }

  has(code) {
    if (!isValid(code)) {
      throw new ErrorInvalidCode(code);
    }
    return this.values.includes(code);
  }
}

const external = CodeGroup.byAddressType(0, 10, 20);
const internal = CodeGroup.byAddressType(1, 11, 21);

const p2sh = CodeGroup.byDirection(internal, external, 'p2sh');
const p2shP2wsh = CodeGroup.byDirection(internal, external, 'p2shP2wsh');
const p2wsh = CodeGroup.byDirection(internal, external, 'p2wsh');

const boundHas = (instance) => instance.has.bind(instance);

const ChainType = t.irreducible('ChainType', (n) => isValid(n));

module.exports = Object.freeze({
  ErrorInvalidCode,
  ChainType,

  codes: Object.freeze({
    internal,
    external,
    p2sh,
    p2shP2wsh,
    p2wsh,
    all: Object.freeze([...allCodes])
  }),

  isValid,
  isP2sh: boundHas(p2sh),
  isP2shP2wsh: boundHas(p2shP2wsh),
  isP2wsh: boundHas(p2wsh),
  isInternal: boundHas(internal),
  isExternal: boundHas(external)
});
