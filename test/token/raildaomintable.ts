import { ethers } from 'hardhat';
import { expect } from 'chai';

describe('Token/RailDaoMintable', function () {
  it('Should mint coins', async function () {
    const Rail = await ethers.getContractFactory('RailTokenDAOMintable');

    // Deploy with initial supply of 10 and hard cap of 100
    const rail = await Rail.deploy(
      (
        await ethers.getSigners()
      )[0].address,
      10,
      100,
      (
        await ethers.getSigners()
      )[0].address,
      'RAIL',
      'RAIL',
    );

    const rail2 = rail.connect((await ethers.getSigners())[1]);

    // Mint 10 extra coins to bring supply to 20
    await expect(rail.governanceMint((await ethers.getSigners())[0].address, 10))
      .to.emit(rail, 'Transfer')
      .withArgs(ethers.constants.AddressZero, (await ethers.getSigners())[0].address, 10);

    // Minting 90 extra coins would result in supply of 110, should fail
    await expect(
      rail.governanceMint((await ethers.getSigners())[0].address, 90),
    ).to.be.revertedWith("RailTokenDAOMintable: Can't mint more than hard cap");

    // Calling mint from an address that's not the owner should fail
    await expect(
      rail2.governanceMint((await ethers.getSigners())[0].address, 10),
    ).to.be.revertedWith('Ownable: caller is not the owner');
  });
});
