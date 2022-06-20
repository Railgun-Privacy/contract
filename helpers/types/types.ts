/* eslint-disable @typescript-eslint/no-explicit-any */

import {BigNumber} from 'ethers/lib/ethers';

// TODO-TESTS: remove any.
export type SerializedTransaction = any;

export type MerkleProof = {
  element: bigint; // element proof is for
  elements: bigint[]; // elements of proof
  indices: bigint; // bit array of left/right positions for each level of the tree
  root: bigint; // root for this proof
};

// TODO-TESTS: remove any.
export type BoundParams = any;

export type ProverInputs = {
  merkleRoot: bigint;
  boundParamsHash: bigint;
  nullifiers: bigint[];
  commitmentsOut: bigint[];
  token: bigint;
  publicKey: [bigint, bigint];
  signature: [bigint, bigint, bigint];
  randomIn: bigint[];
  valueIn: bigint[];
  pathElements: bigint[][];
  leavesIndices: bigint[];
  nullifyingKey: bigint;
  npkOut: bigint[];
  valueOut: bigint[];
};

// TODO-TESTS: remove any.
export type Proof = any;

export type SolidityProof = {
  a: {x: bigint; y: bigint};
  b: {
    x: [bigint, bigint];
    y: [bigint, bigint];
  };
  c: {x: bigint; y: bigint};
};

// TODO-TESTS: remove any.
export type Artifact = any;

// TODO-TESTS: remove any.
export type ArtifactConfig = any;

// TODO-TESTS: remove any.
export type PublicInputs = any;

// TODO-TESTS: remove any.
export type CircuitInputs = any;

// TODO-TESTS: remove any.
export type VKeyJson = any;

export type FormattedVKey = {
  artifactsIPFSHash: '';
  alpha1: {
    x: bigint;
    y: bigint;
  };
  beta2: {
    x: [bigint, bigint];
    y: [bigint, bigint];
  };
  gamma2: {
    x: [bigint, bigint];
    y: [bigint, bigint];
  };
  delta2: {
    x: [bigint, bigint];
    y: [bigint, bigint];
  };
  ic: {
    x: bigint;
    y: bigint;
  }[];
};

export type CommitmentTokenData = {
  tokenType: BigNumber;
  tokenAddress: string;
  tokenSubID: BigNumber;
};

export type CommitmentPreimageArgs = {
  npk: BigNumber;
  token: CommitmentTokenData;
  value: BigNumber;
};

export type CommitmentCiphertext = {
  ciphertext: (string | bigint)[];
  ephemeralKeys: (string | bigint)[];
  memo: (string | bigint)[];
};
