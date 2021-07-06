// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { Ownable } from  "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Delegator
 * @author Railgun Contributors
 * @notice 'Owner' contract for all railgun contracts
 * delegates permissions to other contracts (voter, role)
 */
contract Delegator is Ownable {
  bytes4 private constant SETPERMISSION_SELECTOR = bytes4(keccak256("setPermission(address,address,bytes4,bool)"));
  bytes4 private constant TRANSFEROWNERSHIP_SELECTOR = bytes4(keccak256("transferOwnership(address)"));
  bytes4 private constant RENOUNCEOWNERSHIP_SELECTOR = bytes4(keccak256("renounceOwnership()"));

  /*
  Mapping structure is calling address => contract => function signature
  0 is used as a wildcard, so permission for contract 0 is permission for
  any contract, and permission for function signature 0 is permission for
  any function.

  Comments below use * to signify wildcard and . notation to seperate address/contract/function.

  caller.*.* allows caller to call any function on any contract
  caller.X.* allows caller to call any function on contract X
  caller.*.Y allows caller to call function Y on any contract
  */
  mapping(
    address => mapping(
      address => mapping(bytes4 => bool)
    )
  ) public permissions;

  event PermissionSet(address caller, address contractAddress, bytes4 selector, bool permission);

  /**
   * @notice Sets initial admin
   */
  constructor(address _admin) {
    Ownable.transferOwnership(_admin);
  }

  /**
   * @notice Sets permission bit
   * @dev See comment on permissions mapping for wildcard format
   * @param _caller - caller to set permissions for
   * @param _contract - contract to set permissions for
   * @param _selector - selector to set permissions for
   * @param _permission - permission bit to set
   */
  function setPermission(
    address _caller,
    address _contract,
    bytes4 _selector,
    bool _permission
   ) public onlyOwner {
    // If permission set is different to new permission then we execute, otherwise skip
    if (permissions[_caller][_contract][_selector] != _permission) {
      // Set permission bit
      permissions[_caller][_contract][_selector] = _permission;

      // Emit event
      emit PermissionSet(_caller, _contract, _selector, _permission);
    }
  }

  /**
   * @notice Checks if caller has permission to execute function
   * @param _caller - caller to check permissions for
   * @param _contract - contract to check
   * @param _selector - function signature to check
   * @return if caller has permission
   */
  function checkPermission(address _caller, address _contract, bytes4 _selector) public view returns (bool) {
    /* 
    See comment on permissions mapping for structure
    Comments below use * to signify wildcard and . notation to seperate contract/function
    */
    if (_caller == Ownable.owner()) {
      // Owner always has global permissions
      return true;
    } else if (permissions[_caller][_contract][_selector]) {
      // Permission for function is given
      return true;
    } else if (permissions[_caller][_contract][0x0]) {
      // Permission for _contract.* is given
      return true;
    } else if (permissions[_caller][address(0)][_selector]) {
      // Permission for *._selector is given
      return true;
    } else if (permissions[_caller][address(0)][0x0]) {
      // Global permission is given
      return true;
    } else {
      // No permissions
      return false;
    }
  }

  /**
   * @notice Calls function
   * @dev calls to functions on this contract are intercepted and run directly
   * this is so the voting contract doesn't need to have special cases for calling
   * functions other than this one.
   * @param _contract - contract to call
   * @param _selector - function signature to call
   * @param _data - data to pass to function
   * @return success - whether call succeeded
   * @return returnData - return data from function call
   */
  function callContract(address _contract, bytes4 _selector, bytes calldata _data) public returns (bool success, bytes memory returnData) {
    // Example selector for ERC20 transfer function:
    // bytes4(keccak256("transfer(address,uint256)")) = 0xa9059cbb

    // Check permissions
    require(checkPermission(msg.sender, _contract, _selector), "Delegator: Caller doesn't have permission");

    // Intercept calls to this contract
    if (_contract == address(this)) {
      if (_selector == SETPERMISSION_SELECTOR) {
        // Decode call data
        (
          address caller,
          address calledContract,
          bytes4 selector,
          bool permission
        ) = abi.decode(_data, (address, address, bytes4, bool));

        // Call setPermission
        setPermission(caller, calledContract, selector, permission);

        // Return success with empty returndata bytes
        bytes memory empty;
        return (true, empty);
      } else if (_selector == TRANSFEROWNERSHIP_SELECTOR) {
        // Decode call data
        (
          address newOwner
        ) = abi.decode(_data, (address));

        // Call transferOwnership
        Ownable.transferOwnership(newOwner);

        // Return success with empty returndata bytes
        bytes memory empty;
        return (true, empty);
      } else if (_selector == RENOUNCEOWNERSHIP_SELECTOR) {
        // Call renounceOwnership
        Ownable.renounceOwnership();

        // Return success with empty returndata bytes
        bytes memory empty;
        return (true, empty);
      } else { 
        // Return failed with empty returndata bytes
        bytes memory empty;
        return (false, empty);
      }
    }

    // Call external contract and return
    // solhint-disable-next-line avoid-low-level-calls
    return _contract.call(
      abi.encodePacked(
        _selector,
        _data
      )
    );
  }
}
