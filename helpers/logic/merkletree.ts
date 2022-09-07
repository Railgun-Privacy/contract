import { ethers } from 'hardhat';
import { toBigIntBE, toBufferBE } from '@trufflesuite/bigint-buffer';
import { SNARK_SCALAR_FIELD } from './constants';
import { poseidon } from './crypto';

export interface MerkleProof {
  element: Buffer;
  elements: Buffer[];
  indices: Buffer;
  root: Buffer;
}

class MerkleTree {
  treeNumber: number;

  depth: number;

  zeros: Buffer[];

  tree: Buffer[][];

  /**
   * Merkle Tree
   *
   * @param treeNumber - merkle tree number
   * @param depth - merkle tree depth
   * @param zeros - zero values for each level of merkle tree
   * @param tree - starting tree
   */
  constructor(treeNumber: number, depth: number, zeros: Buffer[], tree: Buffer[][]) {
    this.treeNumber = treeNumber;
    this.depth = depth;
    this.zeros = zeros;
    this.tree = tree;
  }

  /**
   * Gets tree root
   *
   * @returns root
   */
  get root(): Buffer {
    return this.tree[this.depth][0];
  }

  /**
   * Hashes 2 merkle nodes
   *
   * @param left - left value to hash
   * @param right - right value to hash
   * @returns hash
   */
  static async hashLeftRight(left: Buffer, right: Buffer): Promise<Buffer> {
    return toBufferBE(await poseidon([toBigIntBE(left), toBigIntBE(right)]), 32);
  }

  /**
   * Gets zero value for tree
   *
   * @returns zero value
   */
  static get zeroValue(): Buffer {
    const railgunHash = BigInt(ethers.utils.keccak256(Buffer.from('Railgun', 'utf8')));
    return toBufferBE(railgunHash % SNARK_SCALAR_FIELD, 32);
  }

  /**
   * Gets zero value for each level of a tree
   *
   * @param depth - depth of tree
   * @returns zero values for each level
   */
  static async getZeroValueLevels(depth: number): Promise<Buffer[]> {
    // Initialize empty array for levels
    const levels: Buffer[] = [];

    // First level should be the leaf zero value
    levels.push(this.zeroValue);

    // Loop through remaining levels to root
    for (let level = 1; level < depth; level += 1) {
      // Push left right hash of level below's zero level
      levels.push(await MerkleTree.hashLeftRight(levels[level - 1], levels[level - 1]));
    }

    return levels;
  }

  /**
   * Create Merkle Tree
   *
   * @param treeNumber - tree number
   * @param depth - tree depth
   * @returns tree
   */
  static async createTree(treeNumber = 0, depth = 16): Promise<MerkleTree> {
    const zeros: Buffer[] = await MerkleTree.getZeroValueLevels(depth);
    const tree: Buffer[][] = Array(depth)
      .fill(0)
      .map(() => []);
    tree[depth] = [await MerkleTree.hashLeftRight(zeros[depth - 1], zeros[depth - 1])];

    return new MerkleTree(treeNumber, depth, zeros, tree);
  }
}

export { MerkleTree };
