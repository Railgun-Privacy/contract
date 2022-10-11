import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import { getFee } from '../../../helpers/logic/transaction';
import { hash, edBabyJubJub } from '../../../helpers/global/crypto';
import { bigIntToArray, arrayToHexString, arrayToBigInt } from '../../../helpers/global/bytes';
import { Note } from '../../../helpers/logic/note';

describe('Logic/RailgunLogic/Generic', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    // Set balance and impersonate dummy signer
    await setBalance('0x000000000000000000000000000000000000dEaD', '0x56BC75E2D63100000');
    await impersonateAccount('0x000000000000000000000000000000000000dEaD');
    const snarkBypassSigner = await ethers.getSigner('0x000000000000000000000000000000000000dEaD');

    // Get primary and treasury accounts
    const [primaryAccount, treasuryAccount, adminAccount] = await ethers.getSigners();

    // Deploy poseidon libraries
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    // Deploy and initialize RailgunLogic
    const RailgunLogic = await ethers.getContractFactory('RailgunLogicStub', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });
    const railgunLogic = await RailgunLogic.deploy();
    await railgunLogic.initializeRailgunLogic(
      treasuryAccount.address,
      25n,
      25n,
      25n,
      adminAccount.address,
    );
    const railgunLogicSnarkBypass = railgunLogic.connect(snarkBypassSigner);
    const railgunLogicAdmin = railgunLogic.connect(adminAccount);

    // Deploy test ERC20 and approve for deposit
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const testERC20 = await TestERC20.deploy();
    const testERC20BypassSigner = testERC20.connect(snarkBypassSigner);
    await testERC20.transfer('0x000000000000000000000000000000000000dEaD', 2n ** 256n / 2n);
    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);
    await testERC20BypassSigner.approve(railgunLogic.address, 2n ** 256n - 1n);

    return {
      snarkBypassSigner,
      primaryAccount,
      treasuryAccount,
      adminAccount,
      railgunLogic,
      railgunLogicSnarkBypass,
      railgunLogicAdmin,
      testERC20,
      testERC20BypassSigner,
    };
  }

  it("Shouldn't initialize twice", async () => {
    const { railgunLogic, treasuryAccount, adminAccount } = await loadFixture(deploy);

    await expect(
      railgunLogic.doubleInit(treasuryAccount.address, 25n, 25n, 25n, adminAccount.address),
    ).to.be.revertedWith('Initializable: contract is already initialized');
  });

  it('Should change fee', async () => {
    const { railgunLogic, railgunLogicAdmin } = await loadFixture(deploy);

    // Check initial fees
    expect(await railgunLogicAdmin.depositFee()).to.equal(25n);
    expect(await railgunLogicAdmin.withdrawFee()).to.equal(25n);
    expect(await railgunLogicAdmin.nftFee()).to.equal(25n);

    // Change fee
    await expect(railgunLogicAdmin.changeFee(1n, 25n, 25n))
      .to.emit(railgunLogicAdmin, 'FeeChange')
      .withArgs(1n, 25n, 25n);
    await expect(railgunLogicAdmin.changeFee(1n, 2n, 25n))
      .to.emit(railgunLogicAdmin, 'FeeChange')
      .withArgs(1n, 2n, 25n);
    await expect(railgunLogicAdmin.changeFee(1n, 2n, 3n))
      .to.emit(railgunLogicAdmin, 'FeeChange')
      .withArgs(1n, 2n, 3n);

    // Noop calls shouldn't emit event
    await expect(railgunLogicAdmin.changeFee(1n, 2n, 3n)).to.not.emit(
      railgunLogicAdmin,
      'FeeChange',
    );

    // Check changed fees
    expect(await railgunLogicAdmin.depositFee()).to.equal(1n);
    expect(await railgunLogicAdmin.withdrawFee()).to.equal(2n);
    expect(await railgunLogicAdmin.nftFee()).to.equal(3n);

    // Make sure only governance can change fees
    await expect(railgunLogic.changeFee(4n, 5n, 6n)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    // Fees shouldn't be able to be set to more than 100%
    await expect(railgunLogicAdmin.changeFee(10001n, 5n, 6n)).to.be.revertedWith(
      'RailgunLogic: Deposit Fee exceeds 100%',
    );
    await expect(railgunLogicAdmin.changeFee(3n, 10001n, 6n)).to.be.revertedWith(
      'RailgunLogic: Withdraw Fee exceeds 100%',
    );
  });

  it('Should change treasury', async () => {
    const { railgunLogic, railgunLogicAdmin, primaryAccount, treasuryAccount } = await loadFixture(
      deploy,
    );

    // Check treasury changes
    expect(await railgunLogicAdmin.treasury()).to.equal(treasuryAccount.address);
    await expect(railgunLogicAdmin.changeTreasury(ethers.constants.AddressZero))
      .to.emit(railgunLogicAdmin, 'TreasuryChange')
      .withArgs(ethers.constants.AddressZero);
    expect(await railgunLogicAdmin.treasury()).to.equal(ethers.constants.AddressZero);
    await expect(railgunLogicAdmin.changeTreasury(primaryAccount.address))
      .to.emit(railgunLogicAdmin, 'TreasuryChange')
      .withArgs(primaryAccount.address);

    // Noop calls shouldn't emit event
    await expect(railgunLogicAdmin.changeTreasury(primaryAccount.address)).to.not.emit(
      railgunLogicAdmin,
      'TreasuryChange',
    );

    expect(await railgunLogicAdmin.treasury()).to.equal(primaryAccount.address);

    // Make sure only governance can change treasury
    await expect(railgunLogic.changeTreasury(ethers.constants.AddressZero)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
  });

  it('Should calculate fee', async () => {
    const { railgunLogic } = await loadFixture(deploy);

    const loops = 5n;

    // Loop through fee basis points
    for (let feeBP = 0n; feeBP < loops; feeBP += 1n) {
      // Loop through amounts from 10 to 10^15
      for (let i = 1n; i <= 15n; i += 1n) {
        // Get base amount
        const base = 10n ** i;

        // Get fee amount
        const { fee } = getFee(base, false, feeBP);

        // Get total
        const total = base + fee;

        // Check result is correct for exclusive amount
        expect(await railgunLogic.getFee(base, false, feeBP)).to.deep.equal([base, fee]);

        // Check result is correct for inclusive amount
        expect(await railgunLogic.getFee(total, true, feeBP)).to.deep.equal([base, fee]);
      }
    }
  });

  it('Should calculate token field', async () => {
    const { railgunLogic } = await loadFixture(deploy);

    const loops = 3n;

    // Loop through and hash for ERC20
    for (let i = 0n; i < loops; i += 1n) {
      const tokenData = {
        tokenType: 0,
        tokenAddress: `${arrayToHexString(hash.keccak256(bigIntToArray(i * loops, 32)), true).slice(
          0,
          42,
        )}`,
        tokenSubID: i,
      };

      // Check token field matches address field
      expect(await railgunLogic.getTokenField(tokenData)).to.equal(tokenData.tokenAddress);
    }

    // Unknown token type
    const tokenData = {
      tokenType: 3,
      tokenAddress: `${arrayToHexString(hash.keccak256(new Uint8Array([1])), true).slice(0, 42)}`,
      tokenSubID: 1n,
    };

    // Unknown token types should error
    await expect(railgunLogic.getTokenField(tokenData)).to.be.reverted;
  });

  it('Should hash note preimages', async function () {
    const { railgunLogic } = await loadFixture(deploy);

    let loops = 1n;

    if (process.env.LONG_TESTS === 'yes') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    }

    // Lpp[ through multiple test vectors
    for (let i = 0n; i < loops; i += 1n) {
      // Generate random spending key, viewing key, and token address
      const spendingKey = edBabyJubJub.genRandomPrivateKey();
      const viewingKey = edBabyJubJub.genRandomPrivateKey();
      const tokenAddress = arrayToHexString(
        hash.keccak256(bigIntToArray(i * loops, 32)),
        true,
      ).slice(0, 42);

      // Create note
      const note = new Note(
        spendingKey,
        viewingKey,
        i,
        bigIntToArray(i, 16),
        {
          tokenType: 0,
          tokenAddress,
          tokenSubID: 0n,
        },
        '',
      );

      // Hash commitment and check
      expect(
        await railgunLogic.hashCommitment({
          npk: await note.getNotePublicKey(),
          token: note.tokenData,
          value: note.value,
        }),
      ).to.equal(arrayToBigInt(await note.getHash()));
    }
  });
});
