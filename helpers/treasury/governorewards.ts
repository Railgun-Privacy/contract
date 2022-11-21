import { Staking } from '../../typechain-types';

export interface AccountSnapshot {
  interval: number;
  votingPower: bigint;
}

export interface GlobalsSnapshot {
  interval: number;
  totalVotingPower: bigint;
  totalStaked: bigint;
}

class GovernorRewardsShadow {
  BASIS_POINTS: bigint;

  intervalBP: bigint;

  STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER: number;

  accountSnapshots: Record<string, AccountSnapshot[]> = {};

  globalsSnapshots: GlobalsSnapshot[] = [];

  /**
   * Governor Rewards helper class
   *
   * @param BASIS_POINTS - basis points in 100%
   * @param intervalBP - basis points per interval
   * @param STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER - distribution intervals per staking interval
   */
  constructor(
    BASIS_POINTS: bigint,
    intervalBP: bigint,
    STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER: number,
  ) {
    this.BASIS_POINTS = BASIS_POINTS;
    this.intervalBP = intervalBP;
    this.STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER = STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER;
  }

  /**
   * Convert staking snapshot to distribution snapshot
   *
   * @param snapshot - staking snapshot
   * @returns distribution snapshot
   */
  stakingSnapshotToDistributionSnapshot(snapshot: number) {
    return Math.floor(snapshot / this.STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER);
  }

  /**
   * Convert distribution snapshot to staking snapshot
   *
   * @param snapshot - distribution snapshot
   * @returns staking snapshot
   */
  distributionSnapshotToStakingSnapshot(snapshot: number) {
    return snapshot * this.STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER;
  }

  /**
   * Fetches all account snapshots from staking contract
   *
   * @param account - account to fetch snapshots for
   * @param stakingContract - staking contract to fetch snapshots from
   * @returns complete
   */
  async loadAccountSnapshots(account: string, stakingContract: Staking) {
    // Get length of staking contract snapshots
    const snapshotsLength = Number(await stakingContract.accountSnapshotLength(account));

    // Fetch all account snapshots
    this.accountSnapshots[account] = await Promise.all(
      new Array(snapshotsLength).fill(0).map(async (x, index) => {
        const snapshot = await stakingContract.accountSnapshot(account, index);

        return {
          interval: Number(snapshot.interval),
          votingPower: snapshot.votingPower.toBigInt(),
        };
      }),
    );

    // Fetch current state and push to end as implied snapshot
    const impliedSnapshot = await stakingContract.accountSnapshotAt(
      account,
      await stakingContract.currentInterval(),
      0,
    );

    this.accountSnapshots[account].push({
      interval: Number(impliedSnapshot.interval),
      votingPower: impliedSnapshot.votingPower.toBigInt(),
    });
  }

  /**
   * Fetches all globals snapshots from staking contract
   *
   * @param stakingContract - staking contract to fetch snapshots from
   * @returns complete
   */
  async loadGlobalsSnapshots(stakingContract: Staking) {
    // Get length of staking contract snapshots
    const snapshotsLength = Number(await stakingContract.globalsSnapshotLength());

    // Fetch all globals snapshots
    this.globalsSnapshots = await Promise.all(
      new Array(snapshotsLength).fill(0).map(async (x, index) => {
        const snapshot = await stakingContract.globalsSnapshot(index);

        return {
          interval: Number(snapshot.interval),
          totalVotingPower: snapshot.totalVotingPower.toBigInt(),
          totalStaked: snapshot.totalStaked.toBigInt(),
        };
      }),
    );

    // Fetch current state and push to end as implied snapshot
    const impliedSnapshot = await stakingContract.globalsSnapshotAt(
      await stakingContract.currentInterval(),
      0,
    );

    this.globalsSnapshots.push({
      interval: Number(impliedSnapshot.interval),
      totalVotingPower: impliedSnapshot.totalVotingPower.toBigInt(),
      totalStaked: impliedSnapshot.totalStaked.toBigInt(),
    });
  }

  /**
   * Get account snapshot for interval
   *
   * @param interval - interval to get snapshot for
   * @param account - account to get snapshot for
   * @returns snapshot
   */
  getAccountSnapshot(interval: number, account: string) {
    // Find gets first element that matches condition
    return this.accountSnapshots[account].find((snapshot) => {
      return snapshot.interval >= this.distributionSnapshotToStakingSnapshot(interval);
    });
  }

  /**
   * Get globals snapshot for  interval
   *
   * @param interval - interval to get snapshot for
   * @returns snapshot
   */
  getGlobalSnapshot(interval: number) {
    // Find gets first element that matches condition
    return this.globalsSnapshots.find((snapshot) => {
      return snapshot.interval >= this.distributionSnapshotToStakingSnapshot(interval);
    });
  }

  // calculateEarmarkAmount(treasuryBalance: bigint, intervals: bigint) {
  //   return treasuryBalance * 
  // }
}

export { GovernorRewardsShadow };
