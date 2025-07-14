import { task, types } from 'hardhat/config';

import { diffVkeys } from './shared';

task('deploy:VKeySetter:commit', 'Loads artifacts into VKeySetter contract')
  .addParam('vKeySetter', 'Address of VKeySetter contract')
  .addParam('limit', 'Largest nullifier and commitment count to check diff for', 50, types.int)
  .addParam('chunkSize', 'Chunk size of artifact deployment transactions', 3, types.int)
  .addParam('legacyFeeGwei', 'Legacy transaction type fee in gwei', 0, types.float)
  .addParam('baseFeeGwei', 'Base fee in gwei', 0, types.float)
  .addParam('priorityFeeGwei', 'Priority fee in gwei', 0, types.float)
  .addParam('gasLimit', 'Gas limit of transactions', undefined, types.int)
  .setAction(async function (
    {
      vKeySetter,
      limit,
      chunkSize,
      legacyFeeGwei,
      baseFeeGwei,
      priorityFeeGwei,
      gasLimit,
    }: {
      vKeySetter: string;
      limit: number;
      chunkSize: number;
      legacyFeeGwei: number;
      baseFeeGwei: number;
      priorityFeeGwei: number;
      gasLimit: number;
    },
    hre,
  ) {
    const { ethers } = hre;
    const GWEI = 1000000000;

    // Construct fee object
    const feeObject: {
      gasPrice?: number;
      maxFeePerGas?: number;
      maxPriorityFeePerGas?: number;
      gasLimit: number;
    } = { gasLimit };

    // Logical XNOR of legacyFeeGwei and baseFeeGwei set, only one should be set
    if (!legacyFeeGwei == !baseFeeGwei) {
      throw new Error(
        'Specify legacy tx fee (--legacy-fee-gwei) or eip1559 (--base-fee-gwei, --priority-fee-gwei) but not both',
      );
    }

    // Set legacy fee if specified
    if (legacyFeeGwei) feeObject.gasPrice = legacyFeeGwei * GWEI;

    // Set eip1559 fee if specified
    if (baseFeeGwei) {
      if (!priorityFeeGwei) throw new Error('Priority fee not set (--priority-fee-gwei)');

      feeObject.maxFeePerGas = baseFeeGwei * GWEI;
      feeObject.maxPriorityFeePerGas = priorityFeeGwei * GWEI;
    }

    // Get contract interface
    const vKeySetterContract = await ethers.getContractAt('VKeySetter', vKeySetter);

    // Get target contract interface
    const target = await ethers.getContractAt('Verifier', await vKeySetterContract.verifier());

    // Get diff betweeen source and target contract
    const diff = await diffVkeys(vKeySetterContract, target, limit, true);

    console.log(
      `GENERATING TX'S TO RESOLVE THE FOLLOWING DIFF: ${JSON.stringify(diff, undefined, 2)}`,
    );

    // Get current nonce
    let nonce = await vKeySetterContract.signer.getTransactionCount();

    // Transaction list
    const transactions = [];

    // Loop and generate transactions
    for (let i = 0; i < diff.length; i += chunkSize) {
      // Fetch chunk
      const diffChunk = diff.slice(i, i + chunkSize);

      console.log(`Generating tx for diff chunk ${JSON.stringify(diffChunk, undefined, 2)}`);

      // Generate batch set call from chunk
      transactions.push(
        (
          await vKeySetterContract.batchCommitVerificationKey(
            diffChunk.map((artifact) => artifact.nullifiers),
            diffChunk.map((artifact) => artifact.commitments),
            { nonce, ...feeObject },
          )
        ).wait(),
      );

      // Increment nonce
      nonce += 1;

      // Wait 100ms between submissions to avoid flooding RPC
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms
    }

    console.log('GENERATED TRANSACTIONS');

    // Await all generated transactions
    await Promise.all(transactions);
  });
