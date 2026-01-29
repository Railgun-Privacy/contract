// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract RailgunRegistry is Ownable {
    struct RegistryEntry {
        address implementation;
        uint256 version;
        bool deprecated;
        string name;
        uint256 nameIndex;
    }

    // Temporary marker for this branch until the full governance registry lands.
    bool public constant isMock = true;

    RegistryEntry[] public registryIndex;
    mapping(bytes32 => uint256) public nameIndex;

    event ContractSet(
        string indexed name,
        address indexed contractAddress,
        uint256 version,
        bool deprecated
    );
    event ContractDeprecated(string indexed name, address indexed contractAddress);

    constructor(address _owner) Ownable() {
        _transferOwnership(_owner);
    }

    function _getKey(string memory contractName) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(contractName));
    }

    function _getEntryIndex(bytes32 entryKey) private view returns (uint256) {
        uint256 index = nameIndex[entryKey];

        require(registryIndex.length > index, "Contract not found");
        require(
            keccak256(abi.encodePacked(registryIndex[index].name)) == entryKey,
            "Contract not found"
        );

        return index;
    }

    function getContract(string memory contractName) external view returns (RegistryEntry memory) {
        uint256 index = _getEntryIndex(_getKey(contractName));
        return registryIndex[index];
    }

    function getContractAddress(string memory contractName) external view returns (address) {
        uint256 index = _getEntryIndex(_getKey(contractName));
        RegistryEntry memory entry = registryIndex[index];

        require(entry.deprecated == false, "deprecated.");

        return entry.implementation;
    }

    function getAllContracts() external view returns (RegistryEntry[] memory) {
        return registryIndex;
    }

    function setContract(string memory contractName, address contractAddress, uint256 version) external onlyOwner {
        require(contractAddress != address(0), "Invalid contract address");

        bytes32 entryKey = _getKey(contractName);
        uint256 index = registryIndex.length;

        registryIndex.push(RegistryEntry(contractAddress, version, false, contractName, index));
        nameIndex[entryKey] = index;

        emit ContractSet(contractName, contractAddress, version, false);
    }

    function deprecateContract(string calldata contractName) external onlyOwner {
        uint256 index = _getEntryIndex(_getKey(contractName));
        registryIndex[index].deprecated = true;

        emit ContractDeprecated(contractName, registryIndex[index].implementation);
    }
}
