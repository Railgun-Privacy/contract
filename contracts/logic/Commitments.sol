// SPDX-License-Identifier: UNLICENSED
// Based on code from MACI (https://github.com/appliedzkp/maci/blob/7f36a915244a6e8f98bacfe255f8bd44193e7919/contracts/sol/IncrementalMerkleTree.sol)
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { Commitment, SNARK_SCALAR_FIELD, CIRCUIT_OUTPUTS, CIPHERTEXT_WORDS } from "./Globals.sol";

import { PoseidonT3, PoseidonT6 } from "./Poseidon.sol";

/**
 * @title Commitments
 * @author Railgun Contributors
 * @notice Batch Incremental Merkle Tree for commitments
 * @dev Publically accessible functions to be put in RailgunLogic
 * Relevent external contract calls should be in those functions, not here
 */

contract Commitments is Initializable {
  // NOTE: The order of instantiation MUST stay the same across upgrades
  // add new variables to the bottom of the list and decrement the __gap
  // variable at the end of this file
  // See https://docs.openzeppelin.com/learn/upgrading-smart-contracts#upgrading

  // Commitment added event
  event NewCommitment(
    uint256 indexed treeNumber,
    uint256 indexed position,
    uint256 hash,
    uint256[CIPHERTEXT_WORDS] ciphertext, // Ciphertext order: iv, recipient pubkey (2 x uint256), random, amount, token
    uint256[2] senderPubKey
  );

  // Generated commitment added event
  event NewGeneratedCommitment(
    uint256 indexed treeNumber,
    uint256 indexed position,
    uint256 hash,
    uint256[2] pubkey,
    uint256 random,
    uint256 amount,
    address token
  );

  // Commitment nullifiers
  mapping(uint256 => bool) public nullifiers;

  // The tree depth
  uint256 private constant TREE_DEPTH = 16;

  // Max number of leaves that can be inserted in a single batch
  uint256 internal constant MAX_BATCH_SIZE = CIRCUIT_OUTPUTS;

  // Tree zero value
  uint256 private constant ZERO_VALUE = uint256(keccak256("Railgun")) % SNARK_SCALAR_FIELD;

  // Next leaf index (number of inserted leaves in the current tree)
  uint256 private nextLeafIndex = 0;

  // The Merkle root
  uint256 public merkleRoot;

  // Store new tree root to quickly migrate to a new tree
  uint256 private newTreeRoot;

  // Tree number
  uint256 private treeNumber;

  // The Merkle path to the leftmost leaf upon initialisation. It *should
  // not* be modified after it has been set by the initialize function.
  // Caching these values is essential to efficient appends.
  uint256[TREE_DEPTH] private zeros;

  // Right-most elements at each level
  // Used for efficient upodates of the merkle tree
  uint256[TREE_DEPTH] private filledSubTrees;

  // Whether the contract has already seen a particular Merkle tree root
  // treeNumber => root => seen
  mapping(uint256 => mapping(uint256 => bool)) public rootHistory;


  /**
   * @notice Calculates initial values for Merkle Tree
   * @dev OpenZeppelin initializer ensures this can only be called once
   */

  function initializeCommitments() internal initializer {
    /*
    To initialise the Merkle tree, we need to calculate the Merkle root
    assuming that each leaf is the zero value.
    H(H(a,b), H(c,d))
      /          \
    H(a,b)     H(c,d)
    /   \       /  \
    a    b     c    d
    `zeros` and `filledSubTrees` will come in handy later when we do
    inserts or updates. e.g when we insert a value in index 1, we will
    need to look up values from those arrays to recalculate the Merkle
    root.
    */

    // Calculate zero values
    zeros[0] = ZERO_VALUE;

    // Store the current zero value for the level we just calculated it for
    uint256 currentZero = ZERO_VALUE;

    // Loop through each level
    for (uint256 i = 0; i < TREE_DEPTH; i++) {
      // Push it to zeros array
      zeros[i] = currentZero;

      // Calculate the zero value for this level
      currentZero = hashLeftRight(currentZero, currentZero);
    }

    // Set merkle root and store root to quickly retrieve later
    newTreeRoot = merkleRoot = currentZero;
    rootHistory[treeNumber][currentZero] = true;
  }

  /**
   * @notice Hash 2 uint256 values
   * @param _left - Left side of hash
   * @param _right - Right side of hash
   * @return hash result
   */
  function hashLeftRight(uint256 _left, uint256 _right) private pure returns (uint256) {
    return PoseidonT3.poseidon([
      _left,
      _right
    ]);
  }

  /**
   * @notice Calculates initial values for Merkle Tree
   * @dev OpenZeppelin initializer ensures this can only be called once.
   * Note: this function INTENTIONALLY causes side effects to save on gas.
   * _leafHashes and _count should never be reused.
   * @param _leafHashes - array of leaf hashes to be added to the merkle tree
   * @param _count - number of leaf hashes to be added to the merkle tree
   */

  function insertLeaves(uint256[MAX_BATCH_SIZE] memory _leafHashes, uint256 _count) private {
    /*
    Loop through leafHashes at each level, if the leaf is on the left (index is even)
    then hash with zeros value and update subtree on this level, if the leaf is on the
    right (index is odd) then hash with subtree value. After calculating each hash
    push to relevent spot on leafHashes array. For gas efficiency we reuse the same
    array and use the count variable to loop to the right index each time.

    Example of updating a tree of depth 4 with elements 13, 14, and 15
    [1,7,15]    {1}                    1
                                       |
    [3,7,15]    {1}          2-------------------3
                             |                   |
    [6,7,15]    {2}     4---------5         6---------7
                       / \       / \       / \       / \
    [13,14,15]  {3}  08   09   10   11   12   13   14   15
    [] = leafHashes array
    {} = count variable
    */

    // Current index is the index at each level to insert the hash
    uint256 levelInsertionIndex = nextLeafIndex;

    // Update nextLeafIndex
    nextLeafIndex += _count;

    // Variables for starting point at next tree level
    uint256 nextLevelHashIndex;
    uint256 nextLevelStartIndex;

    // Loop through each level of the merkle tree and update
    for (uint256 level = 0; level < TREE_DEPTH; level++) {
      // Calculate the index to start at for the next level
      // >> is equivilent to / 2 rounded down
      nextLevelStartIndex = levelInsertionIndex >> 1;

      for (uint256 insertionElement = 0; insertionElement < _count; insertionElement++) {
        uint256 left;
        uint256 right;

        // Calculate left/right values
        if (levelInsertionIndex % 2 == 0) {
          // Leaf hash we're updating with is on the left
          left = _leafHashes[insertionElement];
          right = zeros[level];

          // We've created a new subtree at this level, update
          filledSubTrees[level] = _leafHashes[insertionElement];
        } else {
          // Leaf hash we're updating with is on the right
          left = filledSubTrees[level];
          right = _leafHashes[insertionElement];
        }

        // Calculate index to insert hash into leafHashes[]
        // >> is equivilent to / 2 rounded down
        nextLevelHashIndex = (levelInsertionIndex >> 1) - nextLevelStartIndex;

        // Calculate the hash for the next level
        _leafHashes[nextLevelHashIndex] = hashLeftRight(left, right);

        // Increment level insertion index
        levelInsertionIndex++;
      }

      // Get starting levelInsertionIndex value for next level
      levelInsertionIndex = nextLevelStartIndex;

      // Get count of elements for next level
      _count = nextLevelHashIndex + 1;
    }
 
    // Update the Merkle tree root
    merkleRoot = _leafHashes[0];
    rootHistory[treeNumber][merkleRoot] = true;
  }

  /**
   * @notice Creates new merkle tree
   */

  function newTree() internal {
    // Restore merkleRoot to newTreeRoot
    merkleRoot = newTreeRoot;

    // Existing values in filledSubtrees will never be used so overwriting them is unnecessary

    // Reset next leaf index to 0
    nextLeafIndex = 0;

    // Increment tree number
    treeNumber++;
  }

  /**
   * @notice Adds commitments to tree and emits events
   * @dev MAX_BATCH_SIZE trades off gas cost and batch size
   * @param _commitments - array of commitments to be added to merkle tree
   */

  function addCommitments(Commitment[CIRCUIT_OUTPUTS] calldata _commitments) internal {
    // Create new tree if existing tree can't contain outputs
    // We insert all new commitment into a new tree to ensure they can be spent in the same transaction
    if ((nextLeafIndex + _commitments.length) > (uint256(2) ** TREE_DEPTH)) { newTree(); }

    // Build insertion array
    uint256[MAX_BATCH_SIZE] memory insertionLeaves;

    for (uint256 i = 0; i < _commitments.length; i++) {
      // Throw if leaf is invalid
      require(
        _commitments[i].hash < SNARK_SCALAR_FIELD,
        "Commitments: context.leafHash[] entries must be < SNARK_SCALAR_FIELD"
      );

      // Push hash to insertion array
      insertionLeaves[i] =  _commitments[i].hash;

      // Emit CommitmentAdded events (for wallets) for all the commitments
      emit NewCommitment(treeNumber, nextLeafIndex + i, _commitments[i].hash, _commitments[i].ciphertext, _commitments[i].senderPubKey);
    }

    // Push the leaf hashes into the Merkle tree
    insertLeaves(insertionLeaves, CIRCUIT_OUTPUTS);
  }

  /**
   * @notice Creates a commitment hash from supplied values and adds to tree
   * @dev This is for DeFi integrations where the resulting number of tokens to be added
   * can't be known in advance (eg. AMM trade where transaction ordering could cause toekn amounts to change)
   * @param _pubkey - pubkey of commitment
   * @param _random - randomness component of commitment
   * @param _amount - amount of commitment
   * @param _token - token ID of commitment
   */

  function addGeneratedCommitment(
    uint256[2] memory _pubkey,
    uint256 _random,
    uint256 _amount,
    address _token
  ) internal {
    // Create new tree if current one can't contain existing tree
    // We insert all new commitment into a new tree to ensure they can be spent in the same transaction
    if ((nextLeafIndex + 1) >= (2 ** TREE_DEPTH)) { newTree(); }

    // Calculate commitment hash
    uint256 hash = PoseidonT6.poseidon([
      _pubkey[0],
      _pubkey[1],
      _random,
      _amount,
      uint256(uint160(_token))
    ]);

    // Emit GeneratedCommitmentAdded events (for wallets) for the commitments
    emit NewGeneratedCommitment(treeNumber, nextLeafIndex, hash, _pubkey, _random, _amount, _token);

    // Push the leaf hash into the Merkle tree
    uint256[CIRCUIT_OUTPUTS] memory insertionLeaves;
    insertionLeaves[0] = hash;
    insertLeaves(insertionLeaves, 1);
  }

  uint256[50] private __gap;
}
