import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Governance/Getters', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    // Get contracts
    const ERC20 = await ethers.getContractFactory('TestERC20');
    const Staking = await ethers.getContractFactory('StakingStub');
    const GovernorRewards = await ethers.getContractFactory('GovernorRewards');
    const Getters = await ethers.getContractFactory('Getters');
    const Treasury = await ethers.getContractFactory('Treasury');

    // Deploy
    const rail = await ERC20.deploy();
    await rail.mint((await ethers.getSigners())[0].address, 2n ** 128n - 1n);
    const staking = await Staking.deploy(rail.address);
    const governorRewards = await GovernorRewards.deploy();
    const treasury = await Treasury.deploy();
    const getters = await Getters.deploy(staking.address, governorRewards.address);

    // Approve entire balance for staking
    await rail.approve(
      staking.address,
      await rail.balanceOf((await ethers.getSigners())[0].address),
    );

    // Deploy a bunch of tokens to use as distribution tokens and sort by integer representation of address
    const distributionTokensUnsorted = await Promise.all(
      Array(12)
        .fill(1)
        .map(() => ERC20.deploy()),
    );

    const distributionTokens = distributionTokensUnsorted.sort((a, b) => {
      return Number(BigInt(a.address) - BigInt(b.address));
    });

    await Promise.all(
      distributionTokens.map(async (token) => token.mint(treasury.address, 2n ** 128n - 1n)),
    );

    // Initialize contracts
    await treasury.initializeTreasury((await ethers.getSigners())[0].address);

    await governorRewards.initializeGovernorRewards(
      staking.address,
      treasury.address,
      0,
      distributionTokens.map((token) => token.address),
    );

    await governorRewards.setIntervalBP(10);

    // Give fee distribution contract transfer role
    await treasury.grantRole(await treasury.TRANSFER_ROLE(), governorRewards.address);

    return {
      rail,
      staking,
      governorRewards,
      treasury,
      distributionTokens,
      getters,
    };
  }

  it('Should return snapshots', async () => {
    const { staking, getters } = await loadFixture(deploy);

    const snapshotInterval = Number(await staking.SNAPSHOT_INTERVAL());

    const snapshots: (number | undefined)[] = [];

    let votingPower = 0;

    for (let i = 0; i < 10; i += 1) {
      // Stake every third interval, interval 0 will never have a snapshot
      if (i % 3 === 0 && i !== 0) {
        snapshots[i] = votingPower;
        votingPower += 100;
        await staking.stake(100);
      }

      // Increase time to next interval
      await time.increase(snapshotInterval);
    }

    // Get snapshots from contract
    const contractAccountSnapshots = await getters.getAccountSnapshots(
      (
        await ethers.getSigners()
      )[0].address,
    );
    const contractGlobalsSnapshots = await getters.getGlobalsSnapshots();

    // Check snapshots number is the same
    expect(contractAccountSnapshots.length).to.equal(
      snapshots.filter((x) => x !== undefined).length,
    );

    expect(contractGlobalsSnapshots.length).to.equal(
      snapshots.filter((x) => x !== undefined).length,
    );

    // Check correct snapshots were returned
    contractAccountSnapshots.forEach((snapshot) => {
      expect(snapshot.votingPower).to.equal(snapshots[Number(snapshot.interval)]);
    });

    contractGlobalsSnapshots.forEach((snapshot) => {
      expect(snapshot.totalVotingPower).to.equal(snapshots[Number(snapshot.interval)]);
    });
  });

  it('Should get claimed', async () => {
    const { staking, governorRewards, getters, distributionTokens } = await loadFixture(deploy);

    // Stake and increase time to distribution interval 10
    const governorRewardsInterval = Number(await governorRewards.DISTRIBUTION_INTERVAL());
    await staking.stake(100);
    await time.increase(governorRewardsInterval * 10);

    await governorRewards.prefetchGlobalSnapshots(
      0,
      10,
      new Array(11).fill(0) as number[],
      distributionTokens.map((token) => token.address),
    );

    // Claim intervals 5 - 10
    await governorRewards.claim(
      distributionTokens.map((token) => token.address),
      (
        await ethers.getSigners()
      )[0].address,
      5,
      10,
      new Array(6).fill(0) as number[],
    );

    // Calculate expected bitmap
    const tokenClaims: boolean[] = new Array(11).fill(false) as boolean[];
    tokenClaims.fill(true, 5, 11);
    const allClaims = new Array(distributionTokens.length).fill(tokenClaims).flat() as boolean[];

    expect(
      await getters.getClaimed(
        (
          await ethers.getSigners()
        )[0].address,
        distributionTokens.map((token) => token.address),
        0,
        10,
      ),
    ).to.deep.equal(allClaims);
  });

  it('Should get earned amounts', async () => {
    const { staking, governorRewards, getters, distributionTokens } = await loadFixture(deploy);

    // Stake and increase time to distribution interval 10
    const governorRewardsInterval = Number(await governorRewards.DISTRIBUTION_INTERVAL());
    await staking.stake(100);
    await time.increase(governorRewardsInterval * 10);

    await governorRewards.prefetchGlobalSnapshots(
      0,
      10,
      new Array(11).fill(0) as number[],
      distributionTokens.map((token) => token.address),
    );

    // Calculate expected array
    const tokensEarned: bigint[] = await Promise.all(
      new Array(11).fill(0).map(async (x, index) => {
        return (await governorRewards.earmarked(distributionTokens[0].address, index)).toBigInt();
      }),
    );

    expect(
      await getters.getEarnedTokensPerInterval(
        (
          await ethers.getSigners()
        )[0].address,
        distributionTokens[0].address,
        0,
        10,
      ),
    ).to.deep.equal(tokensEarned);
  });
});
