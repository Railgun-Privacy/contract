declare module 'circomlibjs' {
  declare type FromMontgomery = (Uint8Array) => Uint8Array;
  declare type ToMongomery = (Uint8Array) => Uint8Array;

  export interface CircomlibSignature {
    R8: [Uint8Array, Uint8Array];
    S: bigint;
  }
  declare interface EdDSA {
    verifyPoseidon(msg: Uint8Array, sig: CircomlibSignature, A: Uint8Array[]): boolean;
    signPoseidon(prv: Uint8Array, msg: Uint8Array): CircomlibSignature;
    prv2pub(prv: Uint8Array): [bigint, bigint];
    F: {
      fromMontgomery: FromMontgomery;
      toMontgomery: ToMongomery;
    };
  }
  export function buildEddsa(): Promise<EdDSA>;

  declare interface PoseidonFunction {
    (inputs: Uint8Array[]): Uint8Array;
    F: {
      fromMontgomery: FromMontgomery;
      toMontgomery: ToMongomery;
    };
  }
  export function buildPoseidon(): Promise<PoseidonFunction>;
  export function buildPoseidonOpt(): Promise<PoseidonFunction>;

  namespace poseidonContract {
    export function createCode(size: number): string;
  }
}
