declare module 'snarkjs' {
  export type Protocols = 'groth16';
  export type Curves = 'bn128';

  export interface SnarkjsProof {
    pi_a: (string | bigint)[];
    pi_b: (string | bigint)[][];
    pi_c: (string | bigint)[];
    protocol: Protocols;
  }

  export type PublicSignals = (string | bigint)[];

  export interface SNARK {
    proof: SnarkjsProof;
    publicSignals: PublicSignals;
  }

  export interface VKey {
    protocol: Protocols;
    curve: Curves;
    nPublic: number;
    vk_alpha_1: (string | bigint)[];
    vk_beta_2: (string | bigint)[][];
    vk_gamma_2: (string | bigint)[][];
    vk_delta_2: (string | bigint)[][];
    vk_alphabeta_12: (string | bigint)[][];
    IC: (string | bigint)[][];
  }

  namespace groth16 {
    declare function fullProve(
      inputs: unknown,
      wasm: Uint8Array,
      zkey: Uint8Array,
      logger?: unknown,
    ): Promise<SNARK>;
    declare function verify(
      vkVerifier: VK,
      publicSignals: PublicSignals,
      proof: SnarkjsProof,
      logger?: unknown,
    ): Promise<boolean>;
  }
}
