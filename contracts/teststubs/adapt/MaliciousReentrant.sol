// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { TokenType, TokenData, CommitmentPreimage, ShieldCiphertext, ShieldRequest, Transaction } from "../../logic/Globals.sol";
import { RelayAdapt } from "../../adapt/Relay.sol";

contract MaliciousReentrant {
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

    // solhint-disable-next-line avoid-low-level-calls
    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.shield.selector, [shieldRequest])
    );

    require(!success, "Reentry was successful");

    RelayAdapt.TokenTransfer memory tokenTransfer = RelayAdapt.TokenTransfer({
      to: address(this),
      token: TokenData({ tokenType: TokenType.ERC20, tokenAddress: address(0), tokenSubID: 0 }),
      value: 100
    });

    // solhint-disable-next-line avoid-low-level-calls
    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.transfer.selector, [tokenTransfer])
    );

    require(!success, "Reentry was successful");

    // solhint-disable-next-line avoid-low-level-calls
    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.wrapBase.selector, uint256(0))
    );

    require(!success, "Reentry was successful");

    // solhint-disable-next-line avoid-low-level-calls
    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.unwrapBase.selector, uint256(0))
    );

    require(!success, "Reentry was successful");

    RelayAdapt.Call[] memory calls = new RelayAdapt.Call[](0);

    // solhint-disable-next-line avoid-low-level-calls
    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.multicall.selector, false, calls)
    );

    require(!success, "Reentry was successful");

    Transaction[] memory transactions = new Transaction[](0);

    RelayAdapt.ActionData memory actionData = RelayAdapt.ActionData({
      random: bytes31(0),
      requireSuccess: false,
      minGasLimit: 0,
      calls: new RelayAdapt.Call[](0)
    });

    // solhint-disable-next-line avoid-low-level-calls
    (success, ) = address(relayAdapt).call(
      abi.encodeWithSelector(relayAdapt.relay.selector, transactions, actionData)
    );

    require(!success, "Reentry was successful");
  }
}
