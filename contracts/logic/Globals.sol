// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// Constants
uint256 constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

enum TokenType {
  ERC20,
  ERC721,
  ERC1155
}

struct TokenData {
  TokenType tokenType;
  address tokenAddress;
  uint256 tokenSubID;
}

struct CommitmentCiphertext {
  bytes32[4] ciphertext; // Ciphertext order: IV & tag (16 bytes each), MPK, random & amount (16 bytes each), token
  bytes32 blindedSenderViewingKey;
  bytes32 blindedReceiverViewingKey;
  bytes additionalData; // Only for sender to decrypt
  bytes memo; // Added to note ciphertext for decryption
}

struct ShieldCiphertext {
  bytes32[2] encryptedRandom; // IV & tag (16 bytes each), unused & random (16 bytes each)
  bytes32 ephemeralKey; // Throwaway key to generate shared key from
}

enum UnshieldType {
  NONE,
  NORMAL,
  REDIRECT
}

struct BoundParams {
  uint16 treeNumber;
  uint256 minGasPrice;
  UnshieldType unshield;
  address adaptContract;
  bytes32 adaptParams;
  // For unshields do not include an element in ciphertext array
  // Ciphertext array length = commitments - unshields
  CommitmentCiphertext[] commitmentCiphertext;
}

struct Transaction {
  SnarkProof proof;
  bytes32 merkleRoot;
  bytes32[] nullifiers;
  bytes32[] commitments;
  BoundParams boundParams;
  CommitmentPreimage unshieldPreimage;
}

struct CommitmentPreimage {
  bytes32 npk; // Poseidon(Poseidon(spending public key, nullifying key), random)
  TokenData token; // Token field
  uint120 value; // Note value
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

struct VerifyingKey {
  string artifactsIPFSHash;
  G1Point alpha1;
  G2Point beta2;
  G2Point gamma2;
  G2Point delta2;
  G1Point[] ic;
}

struct SnarkProof {
  G1Point a;
  G2Point b;
  G1Point c;
}
