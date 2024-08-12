import { task } from 'hardhat/config';

import * as weth9artifact from '../../externalArtifacts/WETH9';

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

task('deploy:test', 'Creates test environment deployment').setAction(async function (
  taskArguments,
  hre,
) {
  const { ethers } = hre;
  await hre.run('compile');

  // Get build artifacts
  const Delegator = await ethers.getContractFactory('Delegator');
  const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
  const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
  const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
  const ProxyAdmin = await ethers.getContractFactory('ProxyAdmin');
  const RailToken = await ethers.getContractFactory('AdminERC20');
  const TestERC20 = await ethers.getContractFactory('TestERC20');
  const TestERC721 = await ethers.getContractFactory('TestERC721');
  const RelayAdapt = await ethers.getContractFactory('RelayAdapt');
  const Staking = await ethers.getContractFactory('Staking');
  const TreasuryImplementation = await ethers.getContractFactory('Treasury');
  const Voting = await ethers.getContractFactory('Voting');

  // Deploy Poseidon libraries
  const poseidonT3 = await PoseidonT3.deploy();
  const poseidonT4 = await PoseidonT4.deploy();

  // Get Railgun Smart Wallet
  const RailgunSmartWallet = await ethers.getContractFactory('RailgunSmartWalletStub', {
    libraries: {
      PoseidonT3: poseidonT3.address,
      PoseidonT4: poseidonT4.address,
    },
  });

  // Deploy RailToken
  const rail = await RailToken.deploy('RailTest', 'RAILTEST');
  await logVerify('AdminERC20', rail, ['RailTest', 'RAILTEST']);
  await rail.adminMint((await ethers.getSigners())[0].address, 50000000n * 10n ** 18n);

  // Deploy Staking
  const staking = await Staking.deploy(rail.address);
  await logVerify('Staking', staking, [rail.address]);

  // Deploy delegator
  const delegator = await Delegator.deploy((await ethers.getSigners())[0].address);
  await logVerify('Delegator', delegator, [(await ethers.getSigners())[0].address]);

  // Deploy voting
  const voting = await Voting.deploy(staking.address, delegator.address);
  await logVerify('Voting', voting, [staking.address, delegator.address]);

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

  // Give deployer address full permissions
  console.log(`\nGiving full governance permissions to ${(await ethers.getSigners())[0].address}`);
  await delegator.setPermission(
    (
      await ethers.getSigners()
    )[0].address,
    ethers.constants.AddressZero,
    '0x00000000',
    true,
  );

  // Transfer contract ownerships
  console.log('\nTransferring ownerships');
  await (await railgun.transferOwnership(delegator.address)).wait();
  await (await proxyAdmin.transferOwnership(delegator.address)).wait();
  await (await delegator.transferOwnership(voting.address)).wait();

  // Deploy WETH9
  const WETH9 = new ethers.ContractFactory(
    weth9artifact.WETH9.abi,
    weth9artifact.WETH9.bytecode,
    (await ethers.getSigners())[0],
  );
  const weth9 = await WETH9.deploy();
  await logVerify('WETH9', weth9, []);

  // Deploy RelayAdapt
  const relayAdapt = await RelayAdapt.deploy(proxy.address, weth9.address);
  await logVerify('Relay Adapt', relayAdapt, [proxy.address, weth9.address]);

  // Deploy test tokens
  const testERC20 = await TestERC20.deploy();
  await logVerify('Test ERC20', testERC20, []);

  const testERC721 = await TestERC721.deploy();
  await logVerify('Test ERC721', testERC721, []);

  console.log('\nDEPLOY CONFIG:');
  console.log({
    delegator: delegator.address,
    governorRewardsImplementation: '',
    governorRewardsProxy: '',
    implementation: implementation.address,
    proxy: proxy.address,
    proxyAdmin: proxyAdmin.address,
    rail: rail.address,
    staking: staking.address,
    testERC20: testERC20.address,
    testERC721: testERC721.address,
    treasuryImplementation: treasuryImplementation.address,
    treasuryProxy: treasuryProxy.address,
    voting: voting.address,
    weth9: weth9.address,
    relayAdapt: relayAdapt.address,
  });
});
