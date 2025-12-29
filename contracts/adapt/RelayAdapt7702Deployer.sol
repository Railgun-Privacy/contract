// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract RelayAdapt7702Deployer is Ownable {
    mapping(address => bool) public isDeployed;
    
    event Deployed(address indexed deployment, bytes32 salt);
    event DeploymentStatusChanged(address indexed deployment, bool status);

    constructor(address _owner) Ownable() {
        _transferOwnership(_owner);
    }

    function deploy(bytes memory creationCode, bytes32 salt) external returns (address deployment) {
        assembly {
            deployment := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        require(deployment != address(0), "Create2 failed");
        
        isDeployed[deployment] = true;
        emit Deployed(deployment, salt);
    }

    function setDeploymentStatus(address deployment, bool status) external onlyOwner {
        isDeployed[deployment] = status;
        emit DeploymentStatusChanged(deployment, status);
    }
}
