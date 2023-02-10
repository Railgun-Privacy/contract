import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  impersonateAccount,
  loadFixture,
  setBalance,
} from '@nomicfoundation/hardhat-network-helpers';

import { getKeys } from '../../helpers/logic/artifacts';

describe('Governance/VKeySetter', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const Delegator = await ethers.getContractFactory('Delegator');
    const VKeySetter = await ethers.getContractFactory('VKeySetter');
    const Verifier = await ethers.getContractFactory('VerifierStub');

    // Deploy delegator
    const delegator = await Delegator.deploy((await ethers.getSigners())[0].address);

    // Deploy verifier
    const verifier = await Verifier.deploy();
    await verifier.transferOwnership(delegator.address);

    // Deploy VKeySetter
    const vKeySetter = await VKeySetter.deploy(
      (
        await ethers.getSigners()
      )[0].address,
      delegator.address,
      verifier.address,
    );

    // Connect to non-admin account
    const vKeySetter1 = vKeySetter.connect((await ethers.getSigners())[1]);

    // Connect to delegator account
    await impersonateAccount(delegator.address);
    await setBalance(delegator.address, 10n ** 18n);
    const vKeyDelegator = vKeySetter.connect(await ethers.getSigner(delegator.address));

    // Give vKeySetter permissions
    await delegator.setPermission(
      vKeySetter.address,
      verifier.address,
      verifier.interface.getSighash('setVerificationKey'),
      true,
    );

    return {
      delegator,
      verifier,
      vKeySetter,
      vKeySetter1,
      vKeyDelegator,
    };
  }

  it('Should set vKey', async () => {
    const { vKeySetter, vKeySetter1 } = await loadFixture(deploy);

    const artifact12 = getKeys(1, 2);

    // Non owner shouldn't be able to set key
    await expect(vKeySetter1.setVerificationKey(1, 2, artifact12.solidityVKey)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    // Should set key
    await vKeySetter.setVerificationKey(1, 2, artifact12.solidityVKey);

    // Retrieve key and check it matches
    const key = await vKeySetter.getVerificationKey(1, 2);
    expect(artifact12.eventVKeyMatcher(key)).to.equal(true);
  });

  it('Should batch set vKey', async () => {
    const { vKeySetter, vKeySetter1 } = await loadFixture(deploy);

    const nullifiers = [1, 2, 1];
    const commitments = [2, 3, 4];
    const artifacts = nullifiers.map((x, i) => getKeys(x, commitments[i]));

    // Non owner shouldn't be able to batch set key
    await expect(
      vKeySetter1.batchSetVerificationKey(
        nullifiers,
        commitments,
        artifacts.map((a) => a.solidityVKey),
      ),
    ).to.be.revertedWith('Ownable: caller is not the owner');

    // Should batch set keys
    await vKeySetter.batchSetVerificationKey(
      nullifiers,
      commitments,
      artifacts.map((a) => a.solidityVKey),
    );

    // Retrieve keys and check they match
    for (let i = 0; i < artifacts.length; i += 1) {
      const key = await vKeySetter.getVerificationKey(nullifiers[i], commitments[i]);
      expect(artifacts[i].eventVKeyMatcher(key)).to.equal(true);
    }
  });

  it('Should commit keys', async () => {
    const { vKeySetter, vKeySetter1, vKeyDelegator, verifier } = await loadFixture(deploy);

    const artifact12 = getKeys(1, 2);

    // Set key
    await vKeySetter.setVerificationKey(1, 2, artifact12.solidityVKey);

    // Set to waiting
    await vKeySetter.stateToWaiting();

    // Shouldn't be able to set more keys if contract isn't in setting state
    await expect(vKeySetter.setVerificationKey(1, 2, artifact12.solidityVKey)).to.be.revertedWith(
      'VKeySetter: Contract is not in setting state',
    );

    // Shouldn't be able to commit until contract is in committing state
    await expect(vKeySetter.commitVerificationKey(1, 2)).to.be.revertedWith(
      'VKeySetter: Contract is not in committing state',
    );

    // Set to committing
    await vKeyDelegator.stateToCommitting();

    // Commit key
    await vKeySetter.commitVerificationKey(1, 2);

    // Non owner shouldn't be able to commit key
    await expect(vKeySetter1.commitVerificationKey(1, 2)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    // Retrieve key and check it matches
    const key = await verifier.getVerificationKey(1, 2);
    expect(artifact12.eventVKeyMatcher(key)).to.equal(true);
  });

  it('Should batch commit keys', async () => {
    const { vKeySetter, vKeySetter1, vKeyDelegator, verifier } = await loadFixture(deploy);

    const nullifiers = [1, 2, 1];
    const commitments = [2, 3, 4];
    const artifacts = nullifiers.map((x, i) => getKeys(x, commitments[i]));

    // Batch set keys
    await vKeySetter.batchSetVerificationKey(
      nullifiers,
      commitments,
      artifacts.map((a) => a.solidityVKey),
    );

    // Set to waiting
    await vKeySetter.stateToWaiting();

    // Set to committing
    await vKeyDelegator.stateToCommitting();

    // Non owner shouldn't be able to batch commit key
    await expect(
      vKeySetter1.batchCommitVerificationKey(nullifiers, commitments),
    ).to.be.revertedWith('Ownable: caller is not the owner');

    // Batch commit key
    await vKeySetter.batchCommitVerificationKey(nullifiers, commitments);

    // Retrieve keys and check they match
    for (let i = 0; i < artifacts.length; i += 1) {
      const key = await verifier.getVerificationKey(nullifiers[i], commitments[i]);
      expect(artifacts[i].eventVKeyMatcher(key)).to.equal(true);
    }
  });

  it('Should enforce state order', async () => {
    const { vKeySetter, vKeySetter1, vKeyDelegator } = await loadFixture(deploy);

    // Check state is setting
    expect(await vKeySetter.state()).to.equal(0);

    // Non-owner should not be able to set to waiting
    await expect(vKeySetter1.stateToWaiting()).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    // Set to waiting
    await vKeySetter.stateToWaiting();

    // Check state is waiting
    expect(await vKeySetter.state()).to.equal(1);

    // Should not be able to go back to setting if contract is in waiting
    await expect(vKeySetter.stateToSetting()).to.be.revertedWith(
      'VKeySetter: Contract is not in committing state',
    );

    // Non-delegator should not be able to set to committing
    await expect(vKeySetter.stateToCommitting()).to.be.revertedWith(
      "VKeySetter: Caller isn't governance",
    );

    // Set to committing
    await vKeyDelegator.stateToCommitting();

    // Check state is committing
    expect(await vKeySetter.state()).to.equal(2);

    // Only owner should be able to go back to setting
    await expect(vKeySetter1.stateToSetting()).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    // Set to setting
    await vKeySetter.stateToSetting();

    // Check state is setting
    expect(await vKeySetter.state()).to.equal(0);
  });
});
