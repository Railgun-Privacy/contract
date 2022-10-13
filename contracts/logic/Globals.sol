// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// Constants
uint256 constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
uint256 constant CIPHERTEXT_WORDS = 4;

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
  uint256[CIPHERTEXT_WORDS] ciphertext; // Ciphertext order: IV & tag (16 bytes each), recipient master public key (packedPoint) (uint256), packedField (uint256) {random, amount}, token (uint256)
  uint256[2] ephemeralKeys; // [blinded sender viewing key, blinded receiver viewing key]
  uint256[] memo; // Additional data
}

struct ShieldCiphertext {
  uint256[2] encryptedRandom; // IV & tag (16 bytes each), unused & random (16 bytes each)
  uint256 ephemeralKey; // Throwaway key to generate shared key from
}

enum UnshieldType {
  NONE,
  NORMAL,
  REDIRECT
}

struct BoundParams {
  uint16 treeNumber;
  UnshieldType unshield;
  address adaptContract;
  bytes32 adaptParams;
  // For unshields do not include an element in ciphertext array
  // Ciphertext array length = commitments - unshields
  CommitmentCiphertext[] commitmentCiphertext;
}

struct Transaction {
  SnarkProof proof;
  uint256 merkleRoot;
  uint256[] nullifiers;
  uint256[] commitments;
  BoundParams boundParams;
  CommitmentPreimage unshieldPreimage;
  address overrideOutput; // Only allowed if original destination == msg.sender & boundParams.unshield == 2
}

struct CommitmentPreimage {
  uint256 npk; // Poseidon(mpk, random), mpk = Poseidon(spending public key, nullifier)
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
