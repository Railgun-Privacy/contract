declare module 'snarkjs';
declare module 'xchacha20-js';
declare module 'railgun-artifacts-node';

declare module 'circomlibjs' {
  export type Signature = {
    R8: [bigint, bigint];
    S: bigint;
  };
  namespace eddsa {
    export function verifyPoseidon(msg: bigint, sig: Signature, A: bigint[]): boolean;
    export function signPoseidon(prv: Uint8Array, msg: bigint): Signature;
    export function prv2pub(prv: Buffer): [bigint, bigint];
  }
  export function poseidon(inputs: bigint[]): bigint;
  namespace poseidonContract {
    export function createCode(size: number): string;
  }
}
