/* global describe it beforeEach ethers */
const { expect } = require('chai');

let treasury;

describe('Treasury/Treasury', () => {
  beforeEach(async () => {
    const Treasury = await ethers.getContractFactory('Treasury');

    treasury = await Treasury.deploy(
      (await ethers.getSigners())[0].address,
    );
  });

  it('Should transfer ETH', async () => {
    await (await ethers.getSigners())[0].sendTransaction({
      to: treasury.address,
      value: 1000n,
    });

    expect(await ethers.provider.getBalance(treasury.address)).to.equal(1000n);

    await treasury.transferETH((await ethers.getSigners())[0].address, 1000n);

    expect(await ethers.provider.getBalance(treasury.address)).to.equal(0n);
  });

  it('Should transfer ERC20', async () => {
    const ERC20 = await ethers.getContractFactory('TestERC20');
    const erc20 = await ERC20.deploy();

    await erc20.transfer(treasury.address, 1000n);

    expect(await erc20.balanceOf(treasury.address)).to.equal(1000n);

    await treasury.transferERC20(erc20.address, (await ethers.getSigners())[0].address, 1000n);

    expect(await erc20.balanceOf(treasury.address)).to.equal(0n);
  });
});
