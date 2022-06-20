import {utils} from 'ethers';
import {poseidon} from 'circomlibjs';
import {MerkleProof} from '../types/types';
import {SNARK_SCALAR_FIELD} from './constants';

export class MerkleTree {
  treeNumber: number;
  depth: number;
  zeros: bigint[];
  tree: bigint[][];

  /**
   * @class MerkleTree
   * @param treeNumber - merkle tree index
   * @param depth - merkle tree depth
   */
  constructor(treeNumber = 0, depth = 16) {
    this.treeNumber = treeNumber;
    this.depth = depth;

    // Calculate zero values
    this.zeros = MerkleTree.getZeroValueLevels(depth);

    // Initialize tree (2d array of merkle tree levels)
    // Don't use .fill([]) here as it fills with references to the same array
    this.tree = Array(depth)
      .fill(0)
      .map(() => []);

    // Set empty tree root
    this.tree[depth] = [MerkleTree.hashLeftRight(this.zeros[depth - 1], this.zeros[depth - 1])];
  }

  /**
   * Rebuilds tree
   */
  rebuildSparseTree() {
    for (let level = 0; level < this.depth; level += 1) {
      this.tree[level + 1] = [];

      for (let pos = 0; pos < this.tree[level].length; pos += 2) {
        this.tree[level + 1].push(
          MerkleTree.hashLeftRight(
            this.tree[level][pos],
            this.tree[level][pos + 1] ?? this.zeros[level]
          )
        );
      }
    }
  }

  /**
   * Inserts leaves into tree
   *
   * @param leaves - array of leaves to add
   */
  insertLeaves(leaves: bigint[]) {
    // Add leaves to tree
    this.tree[0].push(...leaves);

    // Rebuild tree
    this.rebuildSparseTree();
  }

  /**
   * Loads leaves into tree at specific index
   *
   * @param startingIndex - starting index to load leaves in
   * @param leaves - leaves to load
   */
  loadToPosition(startingIndex: number, leaves: bigint[]) {
    // If array isn't long enough, extend it
    if (this.tree[0].length < startingIndex + leaves.length) {
      this.tree[0].length = startingIndex + leaves.length;
    }

    // Splice in leaves
    this.tree[0].splice(startingIndex, startingIndex + leaves.length, ...leaves);

    // REebuild tree
    this.rebuildSparseTree();
  }

  /**
   * Returns leaves of the tree
   *
   * @returns leaves
   */
  get leaves(): bigint[] {
    return this.tree[0];
  }

  /**
   * Generates proof for a merkle tree element
   *
   * @param element - element to generate proof for
   * @returns proof
   */
  generateProof(element: bigint): MerkleProof {
    // Initialize of proof elements
    const elements = [];

    // Get initial index
    const initialIndex = this.tree[0].indexOf(element);
    let index = initialIndex;

    if (index === -1) {
      throw new Error(`Couldn't find ${element} in the MerkleTree`);
    }

    // Loop through each level
    for (let level = 0; level < this.depth; level += 1) {
      if (index % 2 === 0) {
        // If index is even get element on right
        elements.push(this.tree[level][index + 1] ?? this.zeros[level]);
      } else {
        // If index is odd get element on left
        elements.push(this.tree[level][index - 1]);
      }

      // Get index for next level
      index = Math.floor(index / 2);
    }

    const proof: MerkleProof = {
      element,
      elements,
      indices: BigInt(initialIndex),
      root: this.root,
    };
    return proof;
  }

  /**
   * Validates merkle proof
   *
   * @param proof - proof to validate
   * @returns isValid
   */
  static validateProof(proof: MerkleProof): boolean {
    // Parse indicies into binary string
    const indicies = proof.indices
      .toString(2)
      .padStart(proof.elements.length, '0')
      .split('')
      .reverse();

    // Inital currentHash value is the element we're prooving membership for
    let currentHash = proof.element;

    // Loop though each proof level and hash together
    for (let i = 0; i < proof.elements.length; i += 1) {
      if (indicies[i] === '0') {
        currentHash = MerkleTree.hashLeftRight(currentHash, proof.elements[i]);
      } else if (indicies[i] === '1') {
        currentHash = MerkleTree.hashLeftRight(proof.elements[i], currentHash);
      }
    }

    // Return true if result is equal to merkle root
    return currentHash === proof.root;
  }

  /**
   * Gets tree root
   *
   * @returns root
   */
  get root(): bigint {
    return this.tree[this.depth][0];
  }

  /**
   * Hashes 2 merkle nodes
   *
   * @param left - left value to hash
   * @param right - right value to hash
   * @returns hash
   */
  static hashLeftRight(left: bigint, right: bigint): bigint {
    return poseidon([left, right]);
  }

  /**
   * Gets zero value for tree
   *
   * @returns zero value
   */
  static get zeroValue() {
    const railgunHashBI = BigInt(utils.keccak256(Buffer.from('Railgun', 'utf8')));
    return railgunHashBI % SNARK_SCALAR_FIELD;
  }

  /**
   * Gets zero value for each level of a tree
   *
   * @param depth - depth of tree
   * @returns zero values for each level
   */
  static getZeroValueLevels(depth: number): bigint[] {
    // Initialize empty array for levels
    const levels = [];

    // First level should be the leaf zero value
    levels.push(this.zeroValue);

    // Loop through remaining levels to root
    for (let level = 1; level < depth; level += 1) {
      // Push left right hash of level below's zero level
      levels.push(MerkleTree.hashLeftRight(levels[level - 1], levels[level - 1]));
    }

    return levels;
  }
}
