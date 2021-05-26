// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

import { G1Point, G2Point, VerifyingKey, SnarkProof } from "./Types.sol";

library Pairing {
  uint256 private constant PAIRING_INPUT_SIZE = 24;
  uint256 private constant PRIME_Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

  /**
   * @notice Computes the negation of point p
   * @dev The negation of p, i.e. p.plus(p.negate()) should be zero.
   * @return result
   */
  function negate(G1Point memory p) internal pure returns (G1Point memory) {
    // The prime q in the base field F_q for G1
    if (p.x == 0 && p.y == 0) {
      return G1Point(0, 0);
    } else {
      return G1Point(p.x, PRIME_Q - (p.y % PRIME_Q));
    }
  }

  /**
   * @notice Adds 2 G1 points
   * @return result
   */
  function add(G1Point memory p1, G1Point memory p2) internal view returns (G1Point memory) {
    // Format inputs
    uint256[4] memory input;
    input[0] = p1.x;
    input[1] = p1.y;
    input[2] = p2.x;
    input[3] = p2.y;

    // Setup output variables
    bool success;
    G1Point memory result;

    /* solhint-disable no-inline-assembly */
    // Add points
    assembly {
      success := staticcall(sub(gas(), 2000), 6, input, 0xc0, result, 0x60)
      // Use "invalid" to make gas estimation work
      switch success case 0 { invalid() }
    }
    /* solhint-enable no-inline-assembly */

    // Check if operation succeeded
    require(success, "Pairing: Add Failed");

    return result;
  }

  /**
   * @notice Scalar multiplies two G1 points p, s
   * @dev The product of a point on G1 and a scalar, i.e.
   * p == p.scalar_mul(1) and p.plus(p) == p.scalar_mul(2) for all
   * points p.
   */
  function scalarMul(G1Point memory p, uint256 s) internal view returns (G1Point memory r) {
    uint256[3] memory input;
    input[0] = p.x;
    input[1] = p.y;
    input[2] = s;
    bool success;
    
    /* solhint-disable no-inline-assembly */
    assembly {
      success := staticcall(sub(gas(), 2000), 7, input, 0x80, r, 0x60)
      // Use "invalid" to make gas estimation work
      switch success case 0 { invalid() }
    }
    /* solhint-enable no-inline-assembly */

    // Check multiplication succeeded
    require(success, "Pairing: Scalar Multiplication Failed");
  }

  /**
   * @notice Performs pairing check on points
   * @dev The result of computing the pairing check
   * e(p1[0], p2[0]) *  .... * e(p1[n], p2[n]) == 1
   * For example,
   * pairing([P1(), P1().negate()], [P2(), P2()]) should return true.
   * @return if pairing check passed
   */
  function pairing(
    G1Point memory _a1,
    G2Point memory _a2,
    G1Point memory _b1,
    G2Point memory _b2,
    G1Point memory _c1,
    G2Point memory _c2,
    G1Point memory _d1,
    G2Point memory _d2
  ) internal view returns (bool) {
    G1Point[4] memory p1 = [_a1, _b1, _c1, _d1];
    G2Point[4] memory p2 = [_a2, _b2, _c2, _d2];

    uint256[] memory input = new uint256[](PAIRING_INPUT_SIZE);

    for (uint256 i = 0; i < 4; i++) {
      uint256 j = i * 6;
      input[j + 0] = p1[i].x;
      input[j + 1] = p1[i].y;
      input[j + 2] = p2[i].x[0];
      input[j + 3] = p2[i].x[1];
      input[j + 4] = p2[i].y[0];
      input[j + 5] = p2[i].y[1];
    }

    uint256[1] memory out;
    bool success;

    /* solhint-disable no-inline-assembly */
    assembly {
      success := staticcall(
        sub(gas(), 2000),
        8,
        add(input, 0x20),
        mul(PAIRING_INPUT_SIZE, 0x20),
        out,
        0x20
      )
      // Use "invalid" to make gas estimation work
      switch success case 0 { invalid() }
    }
    /* solhint-enable no-inline-assembly */


    require(success, "Pairing: Pairing Verification Failed");

    return true;
  }
}

library Snark {
    uint256 private constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 private constant PRIME_Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    /**
     * @notice Verifies snark proof against proving key
     * @param _vk - Verification Key
     * 
     */
    function verify(
      VerifyingKey memory _vk,
      SnarkProof memory _proof,
      uint256 _input
    ) internal view returns (bool) {
      // Compute the linear combination vkX
      G1Point memory vkX = G1Point(0, 0);

      // Make sure that all points are less than the PRIME_Q
      require(_proof.a.x < PRIME_Q, "Snark: Point a.x is greater than PRIME_Q");
      require(_proof.a.y < PRIME_Q, "Snark: Point a.y is greater than PRIME_Q");

      require(_proof.b.x[0] < PRIME_Q, "Snark: Point b[0].x is greater than PRIME_Q");
      require(_proof.b.y[0] < PRIME_Q, "Snark: Point b[0].y is greater than PRIME_Q");

      require(_proof.b.x[1] < PRIME_Q, "Snark: Point b[1].x is greater than PRIME_Q");
      require(_proof.b.y[1] < PRIME_Q, "Snark: Point b[1].y is greater than PRIME_Q");

      require(_proof.c.x < PRIME_Q, "Snark: Point c.x is greater than PRIME_Q");
      require(_proof.c.y < PRIME_Q, "Snark: Point c.y is greater than PRIME_Q");

      // Make sure input is less than SNARK_SCALAR_FIELD
      require(_input < SNARK_SCALAR_FIELD, "Snark: Input is greater than SNARK_SCALAR_FIELD");

      // Compute vkX
      vkX = Pairing.add(vkX, Pairing.scalarMul(_vk.ic[1], _input));
      vkX = Pairing.add(vkX, _vk.ic[0]);

      // Verify pairing and return
      return Pairing.pairing(
        Pairing.negate(_proof.a),
        _proof.b,
        _vk.alpha1,
        _vk.beta2,
        vkX,
        _vk.gamma2,
        _proof.c,
        _vk.delta2
      );
    }
}

