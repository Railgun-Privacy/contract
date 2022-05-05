// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IWETH } from "./IWETH.sol";
import { RailgunLogic, Transaction, CommitmentPreimage } from "../../logic/RailgunLogic.sol";

/**
 * @title Relay Adapt
 * @author Railgun Contributors
 * @notice Multicall adapt contract for Railgun with relayer support
 */

contract RelayAdapt {
  using SafeERC20 for IERC20;

  struct Call {
    address to;
    bytes data;
    uint256 value;
  }

  struct Result {
    bool success;
    bytes returnData;
  }

  RailgunLogic public railgun;
  IWETH public weth;


  /**
   * @notice Blocks calls from external contracts
   */
  modifier noExternalContract () {
    // This prevents malicious contracts that are being interacted with as part of a multicall
    // from being able to steal funds through reentry or callbacks
    require(
      msg.sender == tx.origin
      || msg.sender == address(this)
      , "GeneralAdapt: Caller is external contract"
    );

    _;
  }

  /**
   * @notice Sets Railgun contract and weth address
   */
  constructor(RailgunLogic _railgun, IWETH _weth) {
    railgun = _railgun;
    weth = _weth;
  }

  /**
   * @notice Executes multicall batch
   * @param _requireSuccess - Whether transaction should throw on multicall failure
   * @param _calls - multicall
   */
  function multicall(
    bool _requireSuccess,
    Call[] calldata _calls
  ) public noExternalContract returns (Result[] memory) {
    // Initialize returnData array
    Result[] memory returnData = new Result[](_calls.length);

    // Loop through each call
    for(uint256 i = 0; i < _calls.length; i++) {
      // Retrieve call
      Call calldata call = _calls[i];

      // NOTE:
      // If any of these calls are to a Railgun transaction, adaptID contract should be set to this contracts address
      // adaptID paramemters set to 0. This will ensure that the transaction can't be extracted and submitted
      // standalone

      // Execute call
      (bool success, bytes memory ret) = call.to.call{value: call.value}(call.data);

      // If requireSuccess is true, throw on failure
      if (_requireSuccess) {
        require(success, "GeneralAdapt: Call Failed");
      }

      // Add call result to returnData
      returnData[i] = Result(success, ret);
    }

    return returnData;
  }

   /**
   * @notice Executes a batch of Railgun transactions
   * @param _transactions - Batch of Railgun transactions to execute
   * @param _additionalData - additional data for transaction adaptID, if calling this function directly this
   * should be a random value (shouldn't be reused if resubmitting the same transaction through another relayer)
   */
  function railgunBatch(
    Transaction[] calldata _transactions,
    bytes memory _additionalData
  ) public noExternalContract {
    // Calculate the expected adaptID parameters value
    // The number of transactions is included here to ensure railgun transactions can't be removed
    // by an adversary while the transaction is still in the mempool
    uint256[ _transactions.lenth] memory firstNullifiers;
    for (uint256 i = 0; i < _transactions.length; i++) {
      //only need first nullifier
      firstNullifiers[i] = _transactions[i].nullifier[0];
    }

    uint256 adaptParams = uint256(
      sha256(
        abi.encode(
          firstNullifiers,
          _transactions.length,
          _additionalData
        )
      )
    );

    // Loop through each transaction and ensure adaptID parameters match
    for(uint256 i = 0; i < _transactions.length; i++) {
      require(_transactions[i].boundParams.adaptParams == adaptParams, "GeneralAdapt: AdaptID Parameters Mismatch");
    }

    // Execute railgun transactions
    railgun.transact(_transactions);
  }

  /**
   * @notice Executes a batch of Railgun deposits
   * @param _deposits - ERC20 tokens to deposit
   * @param _random - Random value (should be less than snark scalar field)
   * @param _pubkey - public key to deposit tokens to
   */
  function deposit(
    IERC20[] calldata _deposits,
    uint256 _random,
    uint256[2] calldata _pubkey
  ) public noExternalContract {
    // Loop through each token specified for deposit and deposit our total balance
    // Due to a quirk with the USDT token contract this will fail if it's approval is
    // non-0 (https://github.com/Uniswap/interface/issues/1034), to ensure that your
    // transaction always succeeds when dealing with USDT/similar tokens make sure the last
    // call in your calls is a call to the token contract with an approval of 0
    GenerateDepositTX[] memory generatedDeposits = new GenerateDepositTX[](_deposits.length);

    for (uint256 i = 0; i < _deposits.length; i++) {
      IERC20 token = _deposits[i];

      // Fetch balance
      uint256 balance = token.balanceOf(address(this));

      // Approve the balance for deposit
      token.safeApprove(
        address(railgun),
        balance
      );

      // Push to deposits array
      generatedDeposits[i] = GenerateDepositTX({
        pubkey: _pubkey,
        random: _random,
        amount: uint120(balance),
        tokenType: 0,
        tokenSubID: 0,
        token: uint256(uint160(address(token)))
      });
    }

    // Deposit back to Railgun
    railgun.generateDeposit(generatedDeposits);
  }

  /**
   * @notice Sends tokens to particular address
   * @param _tokens - ERC20 tokens to send (0x0 is eth)
   * @param _to - ETH address to send to
   */
   function send(
    IERC20[] calldata _tokens,
    address _to
  ) public noExternalContract {
    // Loop through each token specified for deposit and deposit our total balance
    // Due to a quirk with the USDT token contract this will fail if it's approval is
    // non-0 (https://github.com/Uniswap/interface/issues/1034), to ensure that your
    // transaction always succeeds when dealing with USDT/similar tokens make sure the last
    // call in your calls is a call to the token contract with an approval of 0
    for (uint256 i = 0; i < _tokens.length; i++) {
      IERC20 token = _tokens[i];

      if (address(token) == address(0x0)) {
        // Fetch ETH balance
        uint256 balance = address(this).balance;

        // Send ETH
        (bool sent,) = _to.call{value: balance}("");
        require(sent, "Failed to send Ether");
      } else {
        // Fetch balance
        uint256 balance = token.balanceOf(address(this));

        // Send all to address
        token.safeTransfer(_to, balance);
      }
    }
  }

  function wrapAllETH() public noExternalContract {
    // Fetch ETH balance
    uint256 balance = address(this).balance;

    // Wrap
    weth.deposit{value: balance}();
  }

  function unwrapAllWETH() public noExternalContract {
    // Fetch ETH balance
    uint256 balance = weth.balanceOf(address(this));

    // Unwrap
    weth.withdraw(balance);
  }

  /**
   * @notice Executes a batch of Railgun transactions followed by a multicall
   * @param _transactions - Batch of Railgun transactions to execute
   * @param _random - Random value (shouldn't be reused if resubmitting the same transaction through another relayer)
   * @param _requireSuccess - Whether transaction should throw on multicall failure
   * @param _calls - multicall
   */
  function relay(
    Transaction[] calldata _transactions,
    // In an edge case where railgun transactions are submitted into the mempool
    // but not mined followed by a different set of railgun transactions submitted
    // to the mempool with the same calls, an adversary could mix and match
    // transactions as long as the total transaction count remains the same
    // Including the random factor here prevents this from happening
    uint256 _random,
    bool _requireSuccess,
    Call[] calldata _calls
  ) public payable returns (Result[] memory) {
    // Calculate additionalData parameter for adaptID parameters
    bytes memory additionalData = abi.encode(
      _random,
      _requireSuccess,
      _calls
    );

    // Executes railgun batch
    railgunBatch(_transactions, additionalData);

    // Execute multicalls
    Result[] memory returnData = multicall(_requireSuccess, _calls);

    // To execute a multicall and deposit or send the result, encode a call to the relevant function on this
    // contract at the end of your calls array.

    // Return returnData
    return returnData;
  }
}
