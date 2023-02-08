import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

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

    return {
      delegator,
      verifier,
      vKeySetter,
      vKeySetter1,
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
});
