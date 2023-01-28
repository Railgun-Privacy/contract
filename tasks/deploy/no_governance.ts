import { task } from 'hardhat/config';

import { loadAllArtifacts } from '../../helpers/logic/artifacts';
import type { Contract } from 'ethers';

/**
 * Log data to verify contract
 *
 * @param name - name of contract
 * @param contract - contract object
 * @param constructorArguments - constructor arguments
 * @returns promise resolved on deploy deployed
 */
async function logVerify(
  name: string,
  contract: Contract,
  constructorArguments: unknown[],
): Promise<null> {
  console.log(`\nDeploying ${name}`);
  console.log({
    address: contract.address,
    constructorArguments,
  });
  return contract.deployTransaction.wait().then();
}

task(
  'deploy:no_governance',
  'Creates deployment without governance (eg. for use in rollup deployments)',
)
  .addParam('weth9', 'Address of WETH9 wrapped base token contract')
  .setAction(async function ({ weth9 }: { weth9: string }, hre) {
    const { ethers } = hre;
    await hre.run('compile');

    // Get build artifacts
    const Delegator = await ethers.getContractFactory('Delegator');
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
    const ProxyAdmin = await ethers.getContractFactory('ProxyAdmin');
    const RelayAdapt = await ethers.getContractFactory('RelayAdapt');
    const TreasuryImplementation = await ethers.getContractFactory('Treasury');

    // Deploy Poseidon libraries
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    // Get Railgun Smart Wallet
    const RailgunSmartWallet = await ethers.getContractFactory('RailgunSmartWallet', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });

    // Deploy delegator
    const delegator = await Delegator.deploy((await ethers.getSigners())[0].address);
    await logVerify('Delegator', delegator, [(await ethers.getSigners())[0].address]);

    // Deploy treasury implementation
    const treasuryImplementation = await TreasuryImplementation.deploy();
    await logVerify('Treasury Implementation', treasuryImplementation, []);

    // Deploy ProxyAdmin
    const proxyAdmin = await ProxyAdmin.deploy((await ethers.getSigners())[0].address);
    await logVerify('Proxy Admin', proxyAdmin, [(await ethers.getSigners())[0].address]);

    // Deploy treasury proxy
    const treasuryProxy = await Proxy.deploy(proxyAdmin.address);
    await logVerify('Treasury Proxy', treasuryProxy, [proxyAdmin.address]);

    // Deploy Proxy
    const proxy = await Proxy.deploy(proxyAdmin.address);
    await logVerify('Proxy', proxy, [proxyAdmin.address]);

    // Deploy Implementation
    const implementation = await RailgunSmartWallet.deploy();
    await logVerify('Implementation', implementation, []);

    // Set implementation for proxies
    console.log('\nSetting proxy implementations');
    await (await proxyAdmin.upgrade(proxy.address, implementation.address)).wait();
    await (await proxyAdmin.unpause(proxy.address)).wait();
    await (await proxyAdmin.upgrade(treasuryProxy.address, treasuryImplementation.address)).wait();
    await (await proxyAdmin.unpause(treasuryProxy.address)).wait();

    // Get proxied contracts
    const treasury = TreasuryImplementation.attach(treasuryProxy.address);
    const railgun = RailgunSmartWallet.attach(proxy.address);

    // Initialize contracts
    console.log('\nInitializing contracts');
    await (await treasury.initializeTreasury(delegator.address)).wait();
    await (
      await railgun.initializeRailgunLogic(
        treasuryProxy.address,
        25n,
        25n,
        25n,
        (
          await ethers.getSigners()
        )[0].address,
        { gasLimit: 2000000 },
      )
    ).wait();

    // Set artifacts
    console.log('\nSetting Artifacts');
    await loadAllArtifacts(railgun);

    // Transfer contract ownerships
    console.log('\nTransferring ownerships');
    await (await railgun.transferOwnership(delegator.address)).wait();
    await (await proxyAdmin.transferOwnership(delegator.address)).wait();

    // Deploy RelayAdapt
    console.log('\nDeploying Relay Adapt');
    const relayAdapt = await RelayAdapt.deploy(proxy.address, weth9);
    await logVerify('Relay Adapt', relayAdapt, [proxy.address, weth9]);

    console.log('\nDEPLOY CONFIG:');
    console.log({
      delegator: delegator.address,
      governorRewardsImplementation: '',
      governorRewardsProxy: '',
      implementation: implementation.address,
      proxy: proxy.address,
      proxyAdmin: proxyAdmin.address,
      rail: '',
      staking: '',
      treasuryImplementation: treasuryImplementation.address,
      treasuryProxy: treasuryProxy.address,
      voting: '',
      relayAdapt: relayAdapt.address,
    });
  });
