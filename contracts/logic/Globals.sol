// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// Constants
uint256 constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
uint256 constant CIPHERTEXT_WORDS = 6;

// Transaction token data
struct TokenData {
  uint8 tokenType; // ENUM: 0 = ERC20, 1 = ERC721, 2 = ERC1155
  address tokenAddress;
  uint256 tokenSubID;
}

// Transaction bound parameters
struct BoundParams {
  address outputEthAddress;
  address adaptContract;
  bytes32 adaptParams;
}

// Commitment ciphertext
struct CommitmentCiphertext {
  uint256[CIPHERTEXT_WORDS] ciphertext; // Ciphertext order: iv & tag (16 bytes each), recipient pubkey (2 x uint256), random, amount, token
  uint256[2] ephemeralKeys; // Sender first, receipient second
  bytes32[] memo;
}

// Transaction struct
struct Transaction {
  SnarkProof proof;
  uint16 treeNumber;
  uint256 merkleRoot;
  uint256[] nullifiers;
  uint256[] commitments;
  TokenData tokenData;
  BoundParams boundParams;
  CommitmentCiphertext[] commitmentCiphertext;
}

// Commitment hash preimage
struct GeneratedCommitment {
  uint256[2] pubkey;
  uint256 random;
  uint120 amount;
  uint256 token;
}

// Commitment hash preimage
struct GenerateDepositTX {
  uint256[2] pubkey;
  uint256 random;
  uint120 amount;
  uint8 tokenType; // ENUM: 0 = ERC20, 1 = ERC721, 2 = ERC1155
  uint256 tokenSubID;
  uint256 token;
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
  G1Point[2] ic;
}

// Snark proof for transaction
struct SnarkProof {
  G1Point a;
  G2Point b;
  G1Point c;
}
