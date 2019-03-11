import * as tcomb from 'tcomb';

export type ChainCode = number;

class ErrorInvalidCode extends Error {
  constructor(code: ChainCode) {
    super(`invalid code ${code}`);
  }
}

enum UnspentType {
  p2sh = 'p2sh',
  p2shP2wsh = 'p2shP2wsh',
  p2wsh = 'p2wsh',
}

enum Purpose {
  internal = 'internal',
  external = 'external',
}

interface ICode {
  id: ChainCode;
  type: UnspentType;
  purpose: Purpose;
}

const codeList: ReadonlyArray<Readonly<ICode>> = Object.freeze((
  [
    [0, UnspentType.p2sh, Purpose.external],
    [10, UnspentType.p2shP2wsh, Purpose.external],
    [20, UnspentType.p2wsh, Purpose.external],

    [1, UnspentType.p2sh, Purpose.internal],
    [11, UnspentType.p2shP2wsh, Purpose.internal],
    [21, UnspentType.p2wsh, Purpose.internal],
  ] as Array<[ChainCode, UnspentType, Purpose]>
).map(([id, type, purpose]) => Object.freeze({ id, type, purpose })));

export const ChainType = tcomb.irreducible('ChainType', (n) => isValid(n));

export const isValid = (c: ChainCode): boolean =>
  codeList.some(({ id }) => id === c);

const throwIfUndefined = <T>(v: T | undefined): T => {
  if (v === undefined) {
    throw new Error(`expected value to be defined`);
  }
  return v;
};

class CodeGroup {
  public values: ReadonlyArray<ChainCode>;
  constructor(values: Iterable<ChainCode>) {
    this.values = Object.freeze([...values]);
  }

  public has(code: ChainCode): boolean {
    if (!isValid(code)) {
      throw new ErrorInvalidCode(code);
    }
    return this.values.includes(code);
  }
}

class CodesByPurpose extends CodeGroup {
  public internal: ChainCode;
  public external: ChainCode;

  constructor(t: UnspentType) {
    const codeMap: Map<Purpose, ChainCode> = new Map(
      codeList
        .filter(({ type }) => type === t)
        .map(({ purpose, id }): [Purpose, ChainCode] => [purpose, id]),
    );
    if (codeMap.size !== 2) {
      throw new Error(`unexpected result`);
    }

    super(codeMap.values());

    this.internal = throwIfUndefined(codeMap.get(Purpose.internal));
    this.external = throwIfUndefined(codeMap.get(Purpose.external));
  }
}

class CodesByType extends CodeGroup {
  public p2sh: ChainCode;
  public p2shP2wsh: ChainCode;
  public p2wsh: ChainCode;

  constructor(p: Purpose) {
    const codeMap: Map<UnspentType, ChainCode> = new Map(
      codeList
        .filter(({ purpose }) => purpose === p)
        .map(({ type, id }): [UnspentType, ChainCode] => [type, id]),
    );
    if (codeMap.size !== 3) {
      throw new Error(`unexpected result`);
    }

    super(codeMap.values());

    this.p2sh = throwIfUndefined(codeMap.get(UnspentType.p2sh));
    this.p2shP2wsh = throwIfUndefined(codeMap.get(UnspentType.p2shP2wsh));
    this.p2wsh = throwIfUndefined(codeMap.get(UnspentType.p2wsh));
  }
}

export const codes = Object.freeze({
  p2sh: Object.freeze(new CodesByPurpose(UnspentType.p2sh)),
  p2shP2wsh: Object.freeze(new CodesByPurpose(UnspentType.p2shP2wsh)),
  p2wsh: Object.freeze(new CodesByPurpose(UnspentType.p2wsh)),
  external: Object.freeze(new CodesByType(Purpose.external)),
  internal: Object.freeze(new CodesByType(Purpose.internal)),
  all: Object.freeze(codeList.map(({ id }) => id)),
});

const boundHas = (instance: CodeGroup) => instance.has.bind(instance);

export const isP2sh = boundHas(codes.p2sh);
export const isP2shP2wsh = boundHas(codes.p2shP2wsh);
export const isP2wsh = boundHas(codes.p2wsh);
export const isExternal = boundHas(codes.external);
export const isInternal = boundHas(codes.internal);
