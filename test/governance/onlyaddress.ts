import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Governance/OnlyAddress', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const OnlyAddress = await ethers.getContractFactory('OnlyAddress');

    // Deploy OnlyAddress
    const onlyAddress = await OnlyAddress.deploy();

    return {
      onlyAddress,
    };
  }

  it('Should revert unless caller is lock address', async () => {
    const { onlyAddress } = await loadFixture(deploy);

    // Revert if addresses don't match
    await expect(onlyAddress.lock(ethers.constants.AddressZero)).to.be.revertedWith(
      "OnlyAddress: Caller isn't allowed to execute",
    );

    // Pass if addresses match
    await expect(onlyAddress.lock((await ethers.getSigners())[0].address)).to.eventually.be
      .fulfilled;
  });
});
