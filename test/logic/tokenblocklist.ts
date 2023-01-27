import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Logic/TokenBlocklist', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const TokenBlocklistStub = await ethers.getContractFactory('TokenBlocklistStub');
    const tokenBlocklist = await TokenBlocklistStub.deploy();

    const [, signer1] = await ethers.getSigners();

    const tokenBlocklist1 = tokenBlocklist.connect(signer1);

    return {
      tokenBlocklist,
      tokenBlocklist1,
    };
  }

  it('Should add and remove from blocklist', async () => {
    const { tokenBlocklist, tokenBlocklist1 } = await loadFixture(deploy);

    // Should return false if tokens not on the list
    expect(
      await tokenBlocklist.tokenBlocklist('0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D'),
    ).to.equal(false);
    expect(
      await tokenBlocklist.tokenBlocklist('0x3832d2F059E55934220881F831bE501D180671A7'),
    ).to.equal(false);
    expect(
      await tokenBlocklist.tokenBlocklist('0x459086F2376525BdCebA5bDDA135e4E9d3FeF5bf'),
    ).to.equal(false);
    expect(
      await tokenBlocklist.tokenBlocklist('0x1C5db575E2Ff833E46a2E9864C22F4B22E0B37C2'),
    ).to.equal(false);

    // Shouldn't allow non-owner to add to list
    await expect(
      tokenBlocklist1.addToBlocklist([
        '0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D',
        '0x3832d2F059E55934220881F831bE501D180671A7',
        '0x459086F2376525BdCebA5bDDA135e4E9d3FeF5bf',
        '0x1C5db575E2Ff833E46a2E9864C22F4B22E0B37C2',
      ]),
    ).to.be.revertedWith('Ownable: caller is not the owner');

    const addToList = await tokenBlocklist.addToBlocklist([
      '0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D',
      '0x3832d2F059E55934220881F831bE501D180671A7',
      '0x459086F2376525BdCebA5bDDA135e4E9d3FeF5bf',
      '0x1C5db575E2Ff833E46a2E9864C22F4B22E0B37C2',
    ]);

    // Add to list
    await expect(addToList)
      .to.emit(tokenBlocklist, 'AddToBlocklist')
      .withArgs('0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D');
    await expect(addToList)
      .to.emit(tokenBlocklist, 'AddToBlocklist')
      .withArgs('0x3832d2F059E55934220881F831bE501D180671A7');
    await expect(addToList)
      .to.emit(tokenBlocklist, 'AddToBlocklist')
      .withArgs('0x459086F2376525BdCebA5bDDA135e4E9d3FeF5bf');
    await expect(addToList)
      .to.emit(tokenBlocklist, 'AddToBlocklist')
      .withArgs('0x1C5db575E2Ff833E46a2E9864C22F4B22E0B37C2');

    // Shouldn't emit event if already on list
    await expect(
      tokenBlocklist.addToBlocklist(['0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D']),
    ).to.not.emit(tokenBlocklist, 'AddToBlocklist');

    // Should return true if on list
    expect(
      await tokenBlocklist.tokenBlocklist('0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D'),
    ).to.equal(true);
    expect(
      await tokenBlocklist.tokenBlocklist('0x3832d2F059E55934220881F831bE501D180671A7'),
    ).to.equal(true);
    expect(
      await tokenBlocklist.tokenBlocklist('0x459086F2376525BdCebA5bDDA135e4E9d3FeF5bf'),
    ).to.equal(true);
    expect(
      await tokenBlocklist.tokenBlocklist('0x1C5db575E2Ff833E46a2E9864C22F4B22E0B37C2'),
    ).to.equal(true);

    // Shouldn't allow non-owner to remove from list
    await expect(
      tokenBlocklist1.removeFromBlocklist([
        '0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D',
        '0x3832d2F059E55934220881F831bE501D180671A7',
      ]),
    ).to.be.revertedWith('Ownable: caller is not the owner');

    // Should remove from list
    const removeFromList = await tokenBlocklist.removeFromBlocklist([
      '0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D',
      '0x3832d2F059E55934220881F831bE501D180671A7',
    ]);
    await expect(removeFromList)
      .to.emit(tokenBlocklist, 'RemoveFromBlocklist')
      .withArgs('0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D');
    await expect(removeFromList)
      .to.emit(tokenBlocklist, 'RemoveFromBlocklist')
      .withArgs('0x3832d2F059E55934220881F831bE501D180671A7');

    // Shouldn't emit if already removed from list
    await expect(
      tokenBlocklist.removeFromBlocklist(['0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D']),
    ).to.not.emit(tokenBlocklist, 'RemoveFromBlocklist');

    // tokens removed from list should emit false
    expect(
      await tokenBlocklist.tokenBlocklist('0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D'),
    ).to.equal(false);
    expect(
      await tokenBlocklist.tokenBlocklist('0x3832d2F059E55934220881F831bE501D180671A7'),
    ).to.equal(false);
    expect(
      await tokenBlocklist.tokenBlocklist('0x459086F2376525BdCebA5bDDA135e4E9d3FeF5bf'),
    ).to.equal(true);
    expect(
      await tokenBlocklist.tokenBlocklist('0x1C5db575E2Ff833E46a2E9864C22F4B22E0B37C2'),
    ).to.equal(true);
  });
});
