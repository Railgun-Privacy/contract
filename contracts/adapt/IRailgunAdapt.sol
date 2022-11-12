// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

interface IRailgunAdapt {
  // Function should return keccak256(abi.encodePacked("Accept Railgun Session"))
  // = 0x32608f8fdf2c6d4f0ed2d88de1e681933b74955f1b66faaa8e1157bac3c90086
  // 'magic value' to accept session, anything else to reject it
  // gas supplied is 30,000 as in EIP165
  function acceptRailgunSession() external view returns (bytes32);
}
