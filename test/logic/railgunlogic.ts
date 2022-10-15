import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import { getFee } from '../../helpers/logic/transaction';
import { Note, TokenType } from '../../helpers/logic/note';
import { randomBytes } from 'crypto';
import { arrayToHexString } from '../../helpers/global/bytes';

describe('Logic/RailgunLogic', () => {
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
    const [primaryAccount, treasuryAccount, adminAccount, proxyAdminAccount] =
      await ethers.getSigners();

    // Deploy poseidon libraries
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    // Deploy RailgunLogic
    const RailgunLogic = await ethers.getContractFactory('RailgunLogicStub', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });
    let railgunLogic = await RailgunLogic.deploy();

    // Deploy Proxy and set implementation
    const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
    let proxy = await Proxy.deploy(proxyAdminAccount.address);
    proxy = proxy.connect(proxyAdminAccount);
    await proxy.upgrade(railgunLogic.address);
    railgunLogic = railgunLogic.attach(proxy.address);
    await proxy.unpause();

    await railgunLogic.initializeRailgunLogic(
      treasuryAccount.address,
      25,
      25,
      25,
      adminAccount.address,
    );

    const railgunLogicSnarkBypass = railgunLogic.connect(snarkBypassSigner);
    const railgunLogicAdmin = railgunLogic.connect(adminAccount);

    return {
      primaryAccount,
      adminAccount,
      treasuryAccount,
      railgunLogic,
      railgunLogicSnarkBypass,
      railgunLogicAdmin,
    };
  }

  it("Shouldn't initialize twice", async () => {
    const { adminAccount, treasuryAccount, railgunLogic } = await loadFixture(deploy);

    await expect(
      railgunLogic.doubleInit(treasuryAccount.address, 25, 25, 0, adminAccount.address),
    ).to.be.revertedWith('Initializable: contract is already initialized');
  });

  it('Should change fee', async () => {
    const { railgunLogic, railgunLogicAdmin } = await loadFixture(deploy);

    // Check initial fees
    expect(await railgunLogicAdmin.shieldFee()).to.equal(25n);
    expect(await railgunLogicAdmin.unshieldFee()).to.equal(25n);
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
    expect(await railgunLogicAdmin.shieldFee()).to.equal(1n);
    expect(await railgunLogicAdmin.unshieldFee()).to.equal(2n);
    expect(await railgunLogicAdmin.nftFee()).to.equal(3n);

    // Make sure only governance can change fees
    await expect(railgunLogic.changeFee(4n, 5n, 6n)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    // Fees shouldn't be able to be set to more than 100%
    await expect(railgunLogicAdmin.changeFee(10001n, 5n, 6n)).to.be.revertedWith(
      'RailgunLogic: Shield Fee exceeds 100%',
    );
    await expect(railgunLogicAdmin.changeFee(3n, 10001n, 6n)).to.be.revertedWith(
      'RailgunLogic: Unshield Fee exceeds 100%',
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

    const loops = 5;

    // Loop through fee basis points
    for (let feeBP = 0; feeBP < loops; feeBP += 1) {
      // Loop through amounts from 10 to 10^15
      for (let i = 1; i <= 15; i += 1) {
        // Get base amount
        const base = 10n ** BigInt(i);

        // Get fee amount
        const { fee } = getFee(base, false, BigInt(feeBP));

        // Get total
        const total = base + fee;

        // Check result is correct for exclusive amount
        expect(await railgunLogic.getFee(base, false, feeBP)).to.deep.equal([base, fee]);

        // Check result is correct for inclusive amount
        expect(await railgunLogic.getFee(total, true, feeBP)).to.deep.equal([base, fee]);
      }
    }
  });

  it('Should get token field', async () => {
    const { railgunLogic } = await loadFixture(deploy);

    const loops = 5;

    for (let iter = 0; iter <= 5; iter += 1) {
      const erc20Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC20,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: 0n,
        },
        '',
      );

      expect(await railgunLogic.getTokenID(erc20Note.tokenData)).to.deep.equal(
        arrayToHexString(erc20Note.getTokenID(), true),
      );

      const erc721Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC721,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: BigInt(loops * 2),
        },
        '',
      );

      expect(await railgunLogic.getTokenID(erc721Note.tokenData)).to.deep.equal(
        arrayToHexString(erc721Note.getTokenID(), true),
      );

      const erc1155Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC1155,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: BigInt(loops * 2),
        },
        '',
      );

      expect(await railgunLogic.getTokenID(erc1155Note.tokenData)).to.deep.equal(
        arrayToHexString(erc1155Note.getTokenID(), true),
      );
    }
  });

  it('Should pass safety vector checks', async () => {
    const { railgunLogic, railgunLogicAdmin, primaryAccount } = await loadFixture(deploy);
    await expect(railgunLogic.treasury()).to.be.fulfilled;
    await expect(railgunLogic.checkSafetyVectors()).to.be.reverted;
    await expect(railgunLogic.treasury()).to.be.fulfilled;
    await expect(railgunLogic.addVector(BigInt(primaryAccount.address))).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
    await railgunLogicAdmin.addVector(BigInt(primaryAccount.address));
    await expect(railgunLogic.removeVector(BigInt(primaryAccount.address))).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
    await railgunLogicAdmin.removeVector(BigInt(primaryAccount.address));
    await expect(railgunLogic.checkSafetyVectors()).to.be.reverted;
    await railgunLogicAdmin.addVector(BigInt(primaryAccount.address));
    await expect(railgunLogic.treasury()).to.be.fulfilled;
    await expect(railgunLogic.checkSafetyVectors()).to.be.fulfilled;
    await expect(railgunLogic.treasury()).to.be.reverted;
  });

  it('Should hash commitments', async () => {
    const { railgunLogic } = await loadFixture(deploy);

    const loops = 5;

    for (let iter = 0; iter <= 5; iter += 1) {
      const erc20Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC20,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: 0n,
        },
        '',
      );

      expect(
        await railgunLogic.hashCommitment(await erc20Note.getCommitmentPreimage()),
      ).to.deep.equal(arrayToHexString(await erc20Note.getHash(), true));

      const erc721Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC721,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: BigInt(loops * 2),
        },
        '',
      );

      expect(
        await railgunLogic.hashCommitment(await erc721Note.getCommitmentPreimage()),
      ).to.deep.equal(arrayToHexString(await erc721Note.getHash(), true));

      const erc1155Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC1155,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: BigInt(loops * 2),
        },
        '',
      );

      expect(
        await railgunLogic.hashCommitment(await erc1155Note.getCommitmentPreimage()),
      ).to.deep.equal(arrayToHexString(await erc1155Note.getHash(), true));
    }
  });

  it('Should validate commitments', async () => {
    const { railgunLogic, railgunLogicAdmin } = await loadFixture(deploy);

    const validNote = new Note(
      randomBytes(32),
      randomBytes(32),
      100n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 0n,
      },
      '',
    );

    expect(
      await railgunLogic.validateCommitmentPreimage(await validNote.getCommitmentPreimage()),
    ).to.equal(true);

    const zeroNote = new Note(
      randomBytes(32),
      randomBytes(32),
      0n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 0n,
      },
      '',
    );

    expect(
      await railgunLogic.validateCommitmentPreimage(await zeroNote.getCommitmentPreimage()),
    ).to.equal(false);

    const invalidNPK = await validNote.getCommitmentPreimage();
    invalidNPK.npk = new Uint8Array(32).fill(255);

    expect(await railgunLogic.validateCommitmentPreimage(invalidNPK)).to.equal(false);

    await railgunLogicAdmin.addToBlocklist([validNote.tokenData.tokenAddress]);

    expect(
      await railgunLogic.validateCommitmentPreimage(await validNote.getCommitmentPreimage()),
    ).to.equal(false);
  });
});
