import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Governance/Delegator', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const Delegator = await ethers.getContractFactory('Delegator');
    const TargetAlpha = await ethers.getContractFactory('GovernanceTargetAlphaStub');
    const TargetNumber = await ethers.getContractFactory('GovernanceTargetNumberStub');

    // Deploy delegator
    const delegator = await Delegator.deploy((await ethers.getSigners())[1].address);

    // Connect to delegator as admin account
    const delegatorAdmin = delegator.connect((await ethers.getSigners())[1]);

    // Deploy dummy contract targets
    const targetAlpha = await TargetAlpha.deploy();
    const targetNumber = await TargetNumber.deploy();

    return {
      delegator,
      delegatorAdmin,
      targetAlpha,
      targetNumber,
    };
  }

  it('Should set permissions', async () => {
    const { delegator, delegatorAdmin, targetAlpha } = await loadFixture(deploy);

    // Permission should be false initially
    expect(
      await delegator.checkPermission(
        (
          await ethers.getSigners()
        )[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
      ),
    ).to.equal(false);

    // Shouldn't allow non-admin to set permissions
    await expect(
      delegator.setPermission(
        (
          await ethers.getSigners()
        )[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
        true,
      ),
    ).to.be.revertedWith('Ownable: caller is not the owner');

    // Set permission to true
    await expect(
      delegatorAdmin.setPermission(
        (
          await ethers.getSigners()
        )[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
        true,
      ),
    )
      .to.emit(delegatorAdmin, 'GrantPermission')
      .withArgs(
        (
          await ethers.getSigners()
        )[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
      );

    // Calling multiple times should noop
    await expect(
      delegatorAdmin.setPermission(
        (
          await ethers.getSigners()
        )[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
        true,
      ),
    ).to.not.emit(delegatorAdmin, 'GrantPermission');

    // Permission should now be true
    expect(
      await delegator.checkPermission(
        (
          await ethers.getSigners()
        )[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
      ),
    ).to.equal(true);

    // Set permission to false
    await expect(
      delegatorAdmin.setPermission(
        (
          await ethers.getSigners()
        )[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
        false,
      ),
    )
      .to.emit(delegatorAdmin, 'RevokePermission')
      .withArgs(
        (
          await ethers.getSigners()
        )[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
      );

    // Permission should now be false
    expect(
      await delegator.checkPermission(
        (
          await ethers.getSigners()
        )[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
      ),
    ).to.equal(false);

    // Set wildcard permission to true
    await expect(
      delegatorAdmin.setPermission(
        (
          await ethers.getSigners()
        )[0].address,
        ethers.constants.AddressZero,
        '0x00000000',
        true,
      ),
    )
      .to.emit(delegatorAdmin, 'GrantPermission')
      .withArgs((await ethers.getSigners())[0].address, ethers.constants.AddressZero, '0x00000000');

    // Permission should now be true again
    expect(
      await delegator.checkPermission(
        (
          await ethers.getSigners()
        )[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
      ),
    ).to.equal(true);
  });

  it('Should be able to call function with permission', async () => {
    const { delegator, delegatorAdmin, targetAlpha, targetNumber } = await loadFixture(deploy);

    // Set permission to true
    await delegatorAdmin.setPermission(
      (
        await ethers.getSigners()
      )[0].address,
      targetAlpha.address,
      targetAlpha.interface.getSighash('a'),
      true,
    );

    //Should be able to call function
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.encodeFunctionData('a'), 0),
    ).to.be.fulfilled;

    // Other function and contract calls should fail
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.encodeFunctionData('b'), 0),
    ).to.be.revertedWith("Delegator: Caller doesn't have permission");

    await expect(
      delegator.callContract(
        targetNumber.address,
        targetNumber.interface.encodeFunctionData('a'),
        0,
      ),
    ).to.be.revertedWith("Delegator: Caller doesn't have permission");
  });

  it('Should be able to call function with wildcard contract permission', async () => {
    const { delegator, delegatorAdmin, targetAlpha, targetNumber } = await loadFixture(deploy);

    // Set permission to call function on any contract
    await delegatorAdmin.setPermission(
      (
        await ethers.getSigners()
      )[0].address,
      ethers.constants.AddressZero,
      targetAlpha.interface.getSighash('a'),
      true,
    );

    // Should be able to call function on both target contracts
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.encodeFunctionData('a'), 0),
    ).to.be.fulfilled;

    await expect(
      delegator.callContract(
        targetNumber.address,
        targetNumber.interface.encodeFunctionData('a'),
        0,
      ),
    ).to.be.fulfilled;

    // Other function calls should fail
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.encodeFunctionData('b'), 0),
    ).to.be.revertedWith("Delegator: Caller doesn't have permission");

    await expect(
      delegator.callContract(
        targetNumber.address,
        targetNumber.interface.encodeFunctionData('b'),
        0,
      ),
    ).to.be.revertedWith("Delegator: Caller doesn't have permission");
  });

  it('Should be able to call function with wildcard function permission', async () => {
    const { delegator, delegatorAdmin, targetAlpha, targetNumber } = await loadFixture(deploy);

    // Set permission to call any function on target
    await delegatorAdmin.setPermission(
      (
        await ethers.getSigners()
      )[0].address,
      targetAlpha.address,
      '0x00000000',
      true,
    );

    // Any function on target should be callable
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.encodeFunctionData('a'), 0),
    ).to.be.fulfilled;

    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.encodeFunctionData('b'), 0),
    ).to.be.fulfilled;

    // Other contracts should fail
    await expect(
      delegator.callContract(
        targetNumber.address,
        targetNumber.interface.encodeFunctionData('a'),
        0,
      ),
    ).to.be.revertedWith("Delegator: Caller doesn't have permission");

    await expect(
      delegator.callContract(
        targetNumber.address,
        targetNumber.interface.encodeFunctionData('b'),
        0,
      ),
    ).to.be.revertedWith("Delegator: Caller doesn't have permission");
  });

  it('Should intercept calls to self', async () => {
    const { delegator, delegatorAdmin, targetAlpha } = await loadFixture(deploy);

    // Should intercept call to self and change permission
    await delegatorAdmin.callContract(
      delegator.address,
      delegator.interface.encodeFunctionData('setPermission', [
        (await ethers.getSigners())[0].address,
        targetAlpha.address,
        targetAlpha.interface.getSighash('a'),
        true,
      ]),
      0,
    );

    // Should still check for permissions on self-intercept
    await expect(
      delegator.callContract(
        delegator.address,
        delegator.interface.encodeFunctionData('setPermission', [
          (await ethers.getSigners())[0].address,
          targetAlpha.address,
          targetAlpha.interface.getSighash('a'),
          true,
        ]),
        0,
      ),
    ).to.be.revertedWith('Ownable: caller is not the owner');

    // Permission should be changed
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.encodeFunctionData('a'), 0),
    ).to.be.fulfilled;

    // Check all intercepts
    await expect(
      delegatorAdmin.callContract(
        delegator.address,
        delegator.interface.encodeFunctionData('transferOwnership', [
          (await ethers.getSigners())[0].address,
        ]),
        0,
      ),
    ).to.be.fulfilled;

    await expect(delegator.callContract(delegator.address, '0x00000000', 0)).to.be.fulfilled;

    await expect(
      delegator.callContract(
        delegator.address,
        delegator.interface.encodeFunctionData('renounceOwnership'),
        0,
      ),
    ).to.be.fulfilled;
  });
});
