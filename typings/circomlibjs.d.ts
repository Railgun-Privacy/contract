declare module 'circomlibjs' {
  export interface Signature {
    R8: [bigint, bigint];
    S: bigint;
  }

  namespace eddsa {
    export function verifyPoseidon(msg: bigint, sig: Signature, A: bigint[]): boolean;
    export function signPoseidon(prv: Uint8Array, msg: bigint): Signature;
    export function prv2pub(prv: Buffer): [bigint, bigint];
  }

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
