declare module 'circomlibjs' {
  export interface Signature {
    R8: [bigint, bigint];
    S: bigint;
  }

  declare interface EdDSA {
    verifyPoseidon(msg: bigint, sig: Signature, A: bigint[]): boolean;
    signPoseidon(prv: Uint8Array, msg: bigint): Signature;
    prv2pub(prv: Buffer): [bigint, bigint];
  }
  export function buildEddsa(): Promise<EdDSA>;

  declare type FromMontgomery = (Uint8Array) => Uint8Array;
  declare interface PoseidonFunction {
    (inputs: bigint[]): Uint8Array;
    F: {
      fromMontgomery: FromMontgomery;
    };
  }
  export function buildPoseidon(): Promise<PoseidonFunction>;
  export function buildPoseidonOpt(): Promise<PoseidonFunction>;

  namespace poseidonContract {
    export function createCode(size: number): string;
  }
}
