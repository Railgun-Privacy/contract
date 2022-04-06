const ethers = require('ethers');
const { poseidon } = require('circomlibjs');

// eslint-disable-next-line max-len
const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * @typedef MerkleProof
 * @property {bigint} element - element proof is for
 * @property {Array<bigint>} elements - elements of proof
 * @property {bigint} indices - bit array of left/right positions for each level of the tree
 * @property {bigint} root - root for this proof
 */

class MerkleTree {
  /**
   * Merkle Tree
   *
   * @class Contract
   * @param {number} [treeNumber = 0] - merkle tree number
   * @param {number} [depth = TREE_DEPTH] - merkle tree depth
   */
  constructor(treeNumber = 0, depth = 16) {
    // Set depth
    /**
     * @type {number}
     */
    this.depth = depth;

    // Calculate zero values
    /**
     * @type {Array<bigint>}
     */
    this.zeros = MerkleTree.getZeroValueLevels(depth);

    // Initialize tree (2d array of merkle tree levels)
    // Don't use .fill([]) here as it fills with references to the same array
    /**
     * @type {Array<Array<bigint>>}
     */
    this.tree = Array(depth).fill(0).map(() => []);

    // Set empty tree root
    this.tree[depth] = [MerkleTree.hashLeftRight(this.zeros[depth - 1], this.zeros[depth - 1])];

    // Set treenumber
    this.treeNumber = treeNumber;
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
            this.tree[level][pos + 1] ?? this.zeros[level],
          ),
        );
      }
    }
  }

  /**
   * Inserts leaves into tree
   *
   * @param {Array<bigint>} leaves - array of leaves to add
   */
  insertLeaves(leaves) {
    // Add leaves to tree
    this.tree[0].push(...leaves);

    // Rebuild tree
    this.rebuildSparseTree();
  }

  /**
   * Returns leaves of the tree
   *
   * @returns {Array<bigint>} leaves
   */
  get leaves() {
    return this.tree[0];
  }

  /**
   * Generates proof for a merkle tree element
   *
   * @param {bigint} element - element to generate proof for
   * @returns {MerkleProof} proof
   */
  generateProof(element) {
    // Ensure element is BigInt
    // eslint-disable-next-line no-param-reassign
    element = BigInt(element);

    // Initialize of proof elements
    const elements = [];

    // Get initial index
    let index = this.tree[0].indexOf(element);

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

    return {
      element,
      elements,
      indices: BigInt(index),
      root: this.root,
    };
  }

  /**
   * Validates merkle proof
   *
   * @param {MerkleProof} proof - proof to validate
   * @returns {boolean} isValid
   */
  static validateProof(proof) {
    // Parse indicies into binary string
    const indicies = proof.indices.toString(2).padStart(proof.elements.length, '0').split('').reverse();

    // Inital currentHash value is the element we're prooving membership for
    let currentHash = proof.element;

    // Loop though each proof level and hash together
    for (let i = 0; i < proof.elements.length; i += 1) {
      if (indicies[i] === '0') {
        currentHash = MerkleTree.hashLeftRight(
          currentHash,
          proof.elements[i],
        );
      } else if (indicies[i] === '1') {
        currentHash = MerkleTree.hashLeftRight(
          proof.elements[i],
          currentHash,
        );
      }
    }

    // Return true if result is equal to merkle root
    return currentHash === proof.root;
  }

  /**
   * Gets tree root
   *
   * @returns {bigint} root
   */
  get root() {
    return this.tree[this.depth][0];
  }

  /**
   * Hashes 2 merkle nodes
   *
   * @param {bigint} left - left value to hash
   * @param {bigint} right - right value to hash
   * @returns {bigint} hash
   */
  static hashLeftRight(left, right) {
    return poseidon([left, right]);
  }

  /**
   * Gets zero value for tree
   *
   * @returns {bigint} zero value
   */
  static get zeroValue() {
    const railgunHashBI = BigInt(
      ethers.utils.keccak256(
        Buffer.from('Railgun', 'utf8'),
      ),
    );
    return railgunHashBI % SNARK_SCALAR_FIELD;
  }

  /**
   * Gets zero value for each level of a tree
   *
   * @param {number} depth - depth of tree
   * @returns {Array<bigint>} zero values for each level
   */
  static getZeroValueLevels(depth) {
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

module.exports = MerkleTree;
