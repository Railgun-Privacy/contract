// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// Constants
uint256 constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
uint256 constant CIPHERTEXT_WORDS = 4;

// Transaction token data
struct TokenData {
  uint8 tokenType; // ENUM: 0 = ERC20, 1 = ERC721, 2 = ERC1155
  address tokenAddress;
  uint256 tokenSubID;
}

// Commitment ciphertext
struct CommitmentCiphertext {
  uint256[CIPHERTEXT_WORDS] ciphertext; // Ciphertext order: iv & tag (16 bytes each), recipient master public key (packedPoint) (uint256), packedField (uint256){sign, random, amount}, token (uint256)
  uint256[2] ephemeralKeys; // Sender first, receipient second (packed points 32 bytes each)
  bytes32[] memo;
}

// Transaction bound parameters
struct BoundParams {
  uint16 treeNumber;
  uint80 withdrawMask; // Max outputs possible is 80
  address adaptContract;
  bytes32 adaptParams;
  CommitmentCiphertext[] commitmentCiphertext;
}

// Transaction struct
struct Transaction {
  SnarkProof proof;
  uint256 merkleRoot;
  uint256[] nullifiers;
  uint256[] commitments;
  BoundParams boundParams;
}

// Commitment hash preimage
struct CommitmentPreimage {
  uint256 ypubkey; // Y coordinate of master public key
  bool sign; // Public key sign
  uint120 value; // Note value
  uint128 random; // Randomness field
  TokenData token; // Token field
}

struct G1Point {
  uint256 x;
  uint256 y;
}

// Encoding of field elements is: X[0] * z + X[1]
struct G2Point {
  uint256[2] x;
  uint256[2] y;
}

// Verification key for SNARK
struct VerifyingKey {
  string artifactsIPFSHash;
  G1Point alpha1;
  G2Point beta2;
  G2Point gamma2;
  G2Point delta2;
  G1Point[] ic;
}

// Snark proof for transaction
struct SnarkProof {
  G1Point a;
  G2Point b;
  G1Point c;
}
