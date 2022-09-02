/* eslint-disable jsdoc/require-jsdoc */
declare module 'snarkjs';
declare module 'railgun-artifacts-node';

declare module 'xchacha20-js' {
  declare class XChaCha20 {
    encrypt(message: Buffer, nonce: Buffer, key: Buffer): Promise<Buffer>;
    decrypt(ciphertext: Buffer, nonce: Buffer, key: Buffer): Promise<Buffer>;
  }
}

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
  export function poseidon(inputs: bigint[]): bigint;
  namespace poseidonContract {
    export function createCode(size: number): string;
  }
}
