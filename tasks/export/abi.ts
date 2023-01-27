import fs from 'fs';
import path from 'path';
import { task } from 'hardhat/config';

import { additions } from './abi-additions';

const defaultContractABIExports = [
  // Logic
  'contracts/logic/RailgunSmartWallet.sol:RailgunSmartWallet',
  'contracts/adapt/Relay.sol:RelayAdapt',
  // Governance
  'contracts/governance/Getters.sol:Getters',
  'contracts/governance/Staking.sol:Staking',
  'contracts/governance/Voting.sol:Voting',
  'contracts/treasury/GovernorRewards.sol:GovernorRewards',
];

task('abi:clean', 'Clean exported ABI artifacts').setAction((taskArguments, hre) => {
  return new Promise(() => {
    const outputDirectory = path.resolve(hre.config.paths.root, './abi-exports');
    if (!fs.existsSync(outputDirectory)) return null;
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  });
});

task('abi:export', 'Export ABI artifacts')
  .addVariadicPositionalParam('contracts', 'Contracts to export', defaultContractABIExports)
  .setAction(async ({ contracts }: { contracts: string[] }, hre) => {
    // Get output directory and ensure it exists
    const outputDirectory = path.resolve(hre.config.paths.root, './abi-exports');
    if (!fs.existsSync(outputDirectory)) fs.mkdirSync(outputDirectory);

    // Loop through each artifact we need to export
    await Promise.all(
      contracts.map(async (contractName) => {
        // Get the artifact
        const artifact = await hre.artifacts.readArtifact(contractName);

        // Get the ABI
        let abi = artifact.abi;

        // Check if we have any ABI merging to do
        if (Array.isArray(additions[artifact.contractName])) {
          abi = abi.concat(additions[artifact.contractName]);
        }

        if (Array.isArray(additions[`${artifact.sourceName}:${artifact.contractName}`])) {
          abi = abi.concat(additions[`${artifact.sourceName}:${artifact.contractName}`]);
        }

        // Write to destination
        const destination = path.resolve(outputDirectory, artifact.contractName) + '.json';
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.writeFile(destination, `${JSON.stringify(abi, null, 2)}\n`, {
          flag: 'w',
        });
      }),
    );
  });
