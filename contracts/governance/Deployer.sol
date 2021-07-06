// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { Ownable } from  "@openzeppelin/contracts/access/Ownable.sol";
import { Create2 } from  "@openzeppelin/contracts/utils/Create2.sol";

/**
 * @title Deployer
 * @author Railgun Contributors
 * @notice Deterministically deploys contracts with CREATE2
 */
contract Deployer is Ownable {
  bytes1 private constant STARTING_BYTE = 0xff;

  /**
   * @notice Sets initial admin
   */
  constructor(address _admin) {
    Ownable.transferOwnership(_admin);
  }

  /**
   * @notice Deploys contract via Create2
   * @param _amount - ETH amount in wei
   * if non-zero, bytecode must have payable constructor
   * @param _salt - salt for deployment, bytecode+salt pair must
   * not have been used to deploy before
   * @param _bytecode - bytecode to deploy
   * @return deployment - deployment address
   */
  function deploy(
    uint256 _amount,
    bytes32 _salt,
    bytes memory _bytecode
  ) external onlyOwner returns (address deployment) {
    return Create2.deploy(_amount, _salt, _bytecode);
  }

  /**
   * @notice Gets deployment address ahead of time
   * @param _salt - salt
   * @param _bytecodeHash - keccak256 bytecode hash
   * @return deployment - deployment address
   */
  function getAddress(
    bytes32 _salt,
    bytes32 _bytecodeHash
  ) public view returns (address deployment) {
    // Note: We don't use openzeppelin's Create2 library here
    // so that we can maintain compatibility with chains that
    // have a different starting byte to Ethereum (0xff)

    // Calculate deployment hash
    bytes32 hash = keccak256(
      abi.encodePacked(
        STARTING_BYTE,
        address(this),
        _salt,
        _bytecodeHash
      )
    );

    // Cast last 20 bytes of hash to address
    return address(uint160(uint256(hash)));
  }

  /**
   * @notice Gets deployment address ahead of time
   * @param _salt - salt
   * @param _bytecode - bytecode
   * @return deployment - deployment address
   */
  function getAddressFromBytecode(
    bytes32 _salt,
    bytes calldata _bytecode
  ) external view returns (address deployment) {
    // Get bytecode hash
    bytes32 bytecodeHash = keccak256(_bytecode);

    // Return address
    return getAddress(_salt, bytecodeHash);
  }
}
