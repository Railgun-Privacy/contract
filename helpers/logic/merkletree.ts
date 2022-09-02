// import { ethers } from 'hardhat';
// import { poseidon } from 'circomlibjs';
// import { SNARK_SCALAR_FIELD } from './constants';

export interface MerkleProof {
  element: Buffer;
  elements: Buffer[];
  indicies: Buffer;
  root: Buffer;
}

class MerkleTree {
  treenumber: number;

  depth: number;

  /**
   * Merkle Tree
   *
   * @param treenumber - merkle tree number
   * @param depth - merkle tree depth
   */
  constructor(treenumber = 0, depth = 16) {
    this.treenumber = treenumber;
    this.depth = depth;
  }
}

export { MerkleTree };
