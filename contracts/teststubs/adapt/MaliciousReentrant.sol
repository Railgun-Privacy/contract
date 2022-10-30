// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { TokenType, TokenData, CommitmentPreimage, ShieldCiphertext, ShieldRequest } from "../../logic/Globals.sol";
import { RelayAdapt } from "../../adapt/Relay.sol";

contract SimpleSwap {
  function attack() external {
    RelayAdapt relayAdapt = RelayAdapt(payable(msg.sender));

    ShieldRequest memory shieldRequest = ShieldRequest({
      preimage: CommitmentPreimage({
        npk: bytes32(uint256(1)),
        token: TokenData({ tokenType: TokenType.ERC20, tokenAddress: address(0), tokenSubID: 0 }),
        value: 0
      }),
      ciphertext: ShieldCiphertext({
        encryptedBundle: [bytes32(uint256(1)), bytes32(uint256(1)), bytes32(uint256(1))],
        shieldKey: bytes32(uint256(1))
      })
    });

    bool success = false;

    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.shield.selector, shieldRequest)
    );

    require(!success, "Reentry was successful");

    TokenData memory tokenData = TokenData({ tokenType: TokenType.ERC20, tokenAddress: address(0), tokenSubID: 0 });

    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.send.selector, tokenData)
    );

    require(!success, "Reentry was successful");

    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.wrapBase.selector, uint256(0))
    );

    require(!success, "Reentry was successful");

    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.unwrapBase.selector, uint256(0))
    );

    require(!success, "Reentry was successful");

    RelayAdapt.Call[] memory calls = new RelayAdapt.Call[](0);

    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.multicall.selector, false, calls)
    );

    require(!success, "Reentry was successful");
  }
}
