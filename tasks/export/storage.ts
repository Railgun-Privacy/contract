import fs from 'fs';
import path from 'path';
import { task } from 'hardhat/config';

export interface ContractStorage {
  storage: Storage[];
  types: Types;
}

export interface Storage {
  astId: number;
  contract: string;
  label: string;
  offset: number;
  slot: string;
  type: string;
}

export type Types = Record<
  string,
  {
    encoding: string;
    label: string;
    numberOfBytes: string;
  }
>;

const defaultContractStorageExports = [
  // Logic
  'contracts/logic/RailgunSmartWallet.sol:RailgunSmartWallet',
  // Governance
  'contracts/treasury/Treasury.sol:Treasury',
  'contracts/treasury/GovernorRewards.sol:GovernorRewards',
];

task('storage:clean', 'Clean exported ABI artifacts').setAction((taskArguments, hre) => {
  return new Promise(() => {
    const outputDirectory = path.resolve(hre.config.paths.root, './storage-layouts');
    if (!fs.existsSync(outputDirectory)) return null;
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  });
});

task('storage:export', 'Export Storage layouts')
  .addVariadicPositionalParam('contracts', 'Contracts to export', defaultContractStorageExports)
  .setAction(async ({ contracts }: { contracts: string[] }, hre) => {
    // Get output directory and ensure it exists
    const outputDirectory = path.resolve(hre.config.paths.root, './storage-layouts');
    if (!fs.existsSync(outputDirectory)) fs.mkdirSync(outputDirectory);

    // Loop through each artifact we need to export
    await Promise.all(
      contracts.map(async (contractName) => {
        // Get the build info
        const info = await hre.artifacts.getBuildInfo(contractName);

        if (!info) return;

        const [file, contract] = contractName.split(':');

        const storageLayout = // @ts-expect-error extra data injected by solidity compiler
          info.output.contracts[file][contract].storageLayout as ContractStorage;

        const storageArray: Storage[][] = [];

        // Sort items into slots
        storageLayout.storage.forEach((item) => {
          if (item.label === '__gap') return;
          if (!storageArray[parseInt(item.slot)]) storageArray[parseInt(item.slot)] = [];
          storageArray[parseInt(item.slot)].push(item);
        });

        const storageArrayFormatted = storageArray.map((slot) =>
          slot
            .map((item) => `${item.label} (${storageLayout.types[item.type].numberOfBytes} bytes)`)
            .reduce((left, right) => `${left} - ${right}`),
        );

        const destination = path.resolve(outputDirectory, contract) + '.json';
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.writeFile(
          destination,
          `${JSON.stringify(storageArrayFormatted, null, 2)}\n`,
          { flag: 'w' },
        );
      }),
    );
  });
