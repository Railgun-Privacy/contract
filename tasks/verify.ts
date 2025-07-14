import { task } from 'hardhat/config';

import { expect } from 'chai';

task('verify:deployment', 'Verifies deployment parameters on chain')
  .addParam('governanceRoot', 'Address of voting or L2 executor contract')
  .addParam('delegator', 'Address of delegator contract')
  .addParam('proxyAdmin', 'Address of proxy admin contract')
  .addParam('proxy', 'Address of proxy contract')
  .addParam('implementation', 'Address of implementation')
  .addParam('treasuryProxy', 'Address of treasury proxy')
  .addParam('treasuryImplementation', 'Address of treasury implementation')
  .setAction(async function (
    addresses: {
      governanceRoot: string;
      delegator: string;
      proxyAdmin: string;
      proxy: string;
      implementation: string;
      treasuryProxy: string;
      treasuryImplementation: string;
    },
    hre,
  ) {
    const { ethers } = hre;
    await hre.run('compile');

    // Get build artifacts
    const delegator = await ethers.getContractAt('Delegator', addresses.delegator);
    const proxyAdmin = await ethers.getContractAt('ProxyAdmin', addresses.proxyAdmin);
    const railgun = await ethers.getContractAt('RailgunSmartWallet', addresses.proxy);
    const treasury = await ethers.getContractAt('Treasury', addresses.treasuryProxy);

    // Check parameters
    console.log(
      `Ensuring delegator (${addresses.delegator}) is owned by governance root (${addresses.governanceRoot})`,
    );
    expect((await delegator.callStatic.owner()).toLowerCase()).to.equal(
      addresses.governanceRoot.toLowerCase(),
    );

    console.log(
      `Ensuring proxy admin (${addresses.proxyAdmin}) is owned by delegator (${addresses.delegator})`,
    );
    expect((await proxyAdmin.callStatic.owner()).toLowerCase()).to.equal(
      addresses.delegator.toLowerCase(),
    );

    console.log(
      `Ensuring proxy (${addresses.proxy}) is owned by proxy admin (${addresses.proxyAdmin})`,
    );
    expect(
      (
        await railgun.provider.getStorageAt(
          addresses.proxy,
          '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103', // bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1)
        )
      ).slice(26, 66),
    ).to.equal(addresses.proxyAdmin.slice(2, 44).toLowerCase());

    console.log(
      `Ensuring implementation of treasury proxy (${addresses.treasuryProxy}) is set to ${addresses.treasuryImplementation}`,
    );
    expect(
      (
        await railgun.provider.getStorageAt(
          addresses.treasuryProxy,
          '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', // bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1))
        )
      ).slice(26, 66),
    ).to.equal(addresses.treasuryImplementation.slice(2, 44).toLowerCase());

    console.log(
      `Ensuring railgun smart wallet (${addresses.proxy}) is owned by delegator (${addresses.delegator})`,
    );
    expect((await railgun.callStatic.owner()).toLowerCase()).to.equal(
      addresses.delegator.toLowerCase(),
    );

    console.log(
      `Ensuring treasury proxy (${addresses.treasuryProxy}) is owned by proxy admin (${addresses.proxyAdmin})`,
    );
    expect(
      (
        await treasury.provider.getStorageAt(
          addresses.treasuryProxy,
          '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103', // bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1)
        )
      ).slice(26, 66),
    ).to.equal(addresses.proxyAdmin.slice(2, 44).toLowerCase());

    console.log(
      `Ensuring implementation of treasury proxy (${addresses.treasuryProxy}) is set to ${addresses.treasuryImplementation}`,
    );
    expect(
      (
        await treasury.provider.getStorageAt(
          addresses.treasuryProxy,
          '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', // bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1))
        )
      ).slice(26, 66),
    ).to.equal(addresses.treasuryImplementation.slice(2, 44).toLowerCase());

    console.log(
      `Ensuring treasury (${addresses.treasuryProxy}) is owned by delegator (${addresses.delegator})`,
    );
    await expect(
      treasury.callStatic.hasRole(
        await treasury.callStatic.DEFAULT_ADMIN_ROLE(),
        addresses.delegator,
      ),
    ).to.eventually.equal(true);
  });
