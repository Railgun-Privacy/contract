// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// Constants
uint256 constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
uint256 constant CIRCUIT_OUTPUTS = 3;
uint256 constant CIPHERTEXT_WORDS = 6;

// Commitment hash and ciphertext
struct Commitment {
  uint256 hash;
  uint256[CIPHERTEXT_WORDS] ciphertext; // Ciphertext order: iv, recipient pubkey (2 x uint256), random, amount, token
  uint256[2] senderPubKey; // Ephemeral one time use
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
  G1Point alpha1;
  G2Point beta2;
  G2Point gamma2;
  G2Point delta2;
  G1Point[2] ic;
}

struct SnarkProof {
  G1Point a;
  G2Point b;
  G1Point c;
}
