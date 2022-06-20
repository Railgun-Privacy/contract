import {ethers} from 'hardhat';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {Contract} from 'ethers';

chai.use(chaiAsPromised);
const {expect} = chai;

let testERC20: Contract;
let multisend: Contract;

describe('Token/Multisend', () => {
  beforeEach(async () => {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Multisend = await ethers.getContractFactory('Multisend');

    // Deploy token
    testERC20 = await TestERC20.deploy();

    // Deploy multisend
    multisend = await Multisend.deploy();

    // Approve entire balance
    await testERC20.approve(
      multisend.address,
      await testERC20.balanceOf((await ethers.getSigners())[0].address)
    );
  });

  it('Should multisend', async () => {
    const transfer = {
      to: (await ethers.getSigners())[1].address,
      amount: 100n,
    };

    const sendTokens = new Array(200).fill(transfer);

    const sum = sendTokens.map(tx => tx.amount).reduce((left, right) => left + right);

    await multisend.multisend(testERC20.address, sendTokens);

    expect(await testERC20.balanceOf((await ethers.getSigners())[1].address)).to.equal(sum);
  });
});
