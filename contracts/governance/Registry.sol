// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract Registry is Ownable {

    struct RegistryEntry {
        address implementation;
        uint256 version;
        bool deprecated;
        string name;
        uint nameIndex;
    }

    // keep current 'functionality' in POC  PREP FOR REMOVAL
    mapping(address => bool) public isDeployed;
    event Registered(address indexed deployment);

    // indexed system.
    RegistryEntry[] public registryIndex;
    mapping(bytes32 => uint) public nameIndex;
    uint256 namesLength = 0;

    event ContractSet(string indexed name, address indexed contractAddress, uint256 version, bool deprecated);
    event ContractDeprecated(string indexed name, address indexed contractAddress);

    constructor(address _owner) Ownable() {
        _transferOwnership(_owner);
    }

    // keep current 'functionality' in POC PREP FOR REMOVAL
    function setDeploymentStatus(address deployment, bool status) internal onlyOwner {
        isDeployed[deployment] = status;
    }

    function getKey(string memory name) internal view returns (bytes32){
        return keccak256(abi.encodePacked(name));
    }

    function getContract(string memory name) external view returns (RegistryEntry memory) {
        //  → address, version, deprecated flag
        bytes32 entryKey = getKey(name);

        uint256 index = nameIndex[entryKey];

        // Safety check for non-existent entry mapping to 0
        require(registryIndex.length > index, "Contract not found");
        RegistryEntry memory entry = registryIndex[index];
        require(keccak256(abi.encodePacked(entry.name)) == entryKey, "Contract not found");

        return entry;
    }

    function getContractAddress(string memory name) external view returns (address) {
        // → just the address (reverts if deprecated)
        bytes32 entryKey = getKey(name);
        uint256 index = nameIndex[entryKey];

        require(registryIndex.length > index, "Contract not found");
        RegistryEntry memory entry = registryIndex[index];
        require(keccak256(abi.encodePacked(entry.name)) == entryKey, "Contract not found");

        require(entry.deprecated == false, "deprecated.");

        return entry.implementation;

    }

    function getAllContracts() external view returns (RegistryEntry[] memory) {
        return registryIndex;
    }

    function setContract(string memory name, address contractAddress, uint256 version) external onlyOwner {
        //  → address, version, deprecated flag
        bytes32 entryKey = getKey(name);
        uint256 index = namesLength++;

        RegistryEntry memory entry = RegistryEntry(contractAddress, version, false, name, index);
        // artifact from original POC
        setDeploymentStatus(contractAddress, true);
        // end artifact
        nameIndex[entryKey] = index;
        registryIndex.push(entry);
        emit ContractSet(name, contractAddress, version, false);
    }

    function deprecateContract(string calldata name) external onlyOwner {
        // → mark as deprecated
        bytes32 entryKey = getKey(name);
        
        uint256 index = nameIndex[entryKey];
        
        require(registryIndex.length > index, "Contract not found");
        require(keccak256(abi.encodePacked(registryIndex[index].name)) == entryKey, "Contract not found");

        registryIndex[index].deprecated = true;
        
        emit ContractDeprecated(name, registryIndex[index].implementation);
    }
}
