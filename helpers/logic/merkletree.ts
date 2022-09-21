import { ethers } from 'hardhat';
import { bigIntToArray } from '../global/bytes';
import { SNARK_SCALAR_FIELD } from '../global/constants';
import { poseidon } from '../global/crypto';

export interface MerkleProof {
  element: Uint8Array;
  elements: Uint8Array[];
  indices: Uint8Array;
  root: Uint8Array;
}

class MerkleTree {
  treeNumber: number;

  depth: number;

  zeros: Uint8Array[];

  tree: Uint8Array[][];

  /**
   * Merkle Tree
   *
   * @param treeNumber - merkle tree number
   * @param depth - merkle tree depth
   * @param zeros - zero values for each level of merkle tree
   * @param tree - starting tree
   */
  constructor(treeNumber: number, depth: number, zeros: Uint8Array[], tree: Uint8Array[][]) {
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
  get root(): Uint8Array {
    return this.tree[this.depth][0];
  }

  /**
   * Hashes 2 merkle nodes
   *
   * @param left - left value to hash
   * @param right - right value to hash
   * @returns hash
   */
  static hashLeftRight(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
    return poseidon([left, right]);
  }

  /**
   * Gets zero value for tree
   *
   * @returns zero value
   */
  static get zeroValue(): Uint8Array {
    const railgunHash = BigInt(ethers.utils.keccak256(Buffer.from('Railgun', 'utf8')));
    return bigIntToArray(railgunHash % SNARK_SCALAR_FIELD, 32);
  }

  /**
   * Gets zero value for each level of a tree
   *
   * @param depth - depth of tree
   * @returns zero values for each level
   */
  static async getZeroValueLevels(depth: number): Promise<Uint8Array[]> {
    // Initialize empty array for levels
    const levels: Uint8Array[] = [];

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
    const zeros: Uint8Array[] = await MerkleTree.getZeroValueLevels(depth);
    const tree: Uint8Array[][] = Array(depth)
      .fill(0)
      .map(() => []);
    tree[depth] = [await MerkleTree.hashLeftRight(zeros[depth - 1], zeros[depth - 1])];

    return new MerkleTree(treeNumber, depth, zeros, tree);
  }

  /**
   * Rebuilds tree
   *
   * @returns complete
   */
  async rebuildSparseTree() {
    for (let level = 0; level < this.depth; level += 1) {
      this.tree[level + 1] = [];

      for (let pos = 0; pos < this.tree[level].length; pos += 2) {
        this.tree[level + 1].push(
          await MerkleTree.hashLeftRight(
            this.tree[level][pos],
            this.tree[level][pos + 1] ?? this.zeros[level],
          ),
        );
      }
    }
  }

  /**
   * Inserts leaves into tree
   *
   * @param leaves - array of leaves to add
   * @returns complete
   */
  async insertLeaves(leaves: Uint8Array[]) {
    // Add leaves to tree
    this.tree[0].push(...leaves);

    // Rebuild tree
    await this.rebuildSparseTree();
  }
}

export { MerkleTree };
