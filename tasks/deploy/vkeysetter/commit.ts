import { task } from 'hardhat/config';

import artifacts from './artifacts.json';

task('deploy:VKeySetter:commit', 'Commits artifacts from VKeySetter to Verifier')
  .addParam('vKeySetter', 'Address of VKeySetter contract')
  .addOptionalParam('baseFee', 'Base fee in gwei', '0')
  .addOptionalParam('priorityFee', 'Priority fee in gwei', '0')
  .addOptionalParam('legacyFee', 'Legacy transaction type fee in gwei', '0')
  .addOptionalParam('chunkSize', 'Chunk size of artifact deployment transactions', '5')
  .setAction(async function (
    {
      vKeySetter,
      chunkSize,
      baseFee,
      legacyFee,
      priorityFee,
    }: {
      vKeySetter: string;
      chunkSize: string;
      baseFee: string;
      priorityFee: string;
      legacyFee: string;
    },
    hre,
  ) {
    const { ethers } = hre;
    const GWEI = 1000000000n;

    // Parse arguments
    const chunkSizeParsed = parseInt(chunkSize);
    const baseFeeParsed = BigInt(baseFee) * GWEI;
    const priorityFeeParsed = BigInt(priorityFee) * GWEI;
    const legacyFeeFeeParsed = BigInt(legacyFee) * GWEI;

    // Check if XOR of legacy or eip1559 fee arguments are set and construct fee object
    const feeObject: { gasPrice?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } =
      {};

    if (legacyFeeFeeParsed === 0n && baseFeeParsed === 0n && priorityFeeParsed === 0n)
      throw new Error('No transaction fee specified');
    else if (legacyFeeFeeParsed > 0n) {
      if (baseFeeParsed !== 0n || priorityFeeParsed !== 0n)
        throw new Error('Only one type of fee should be set');

      feeObject.gasPrice = legacyFeeFeeParsed;
    } else {
      if (baseFeeParsed === 0n || priorityFeeParsed === 0n)
        throw new Error('Both base and priority fee should be set for EIP1559 transactions');

      feeObject.maxFeePerGas = baseFeeParsed;
      feeObject.maxPriorityFeePerGas = priorityFeeParsed;
    }

    // Get contract interface
    const vKeySetterContract = await ethers.getContractAt('VKeySetter', vKeySetter);

    // Get current nonce
    let nonce = await vKeySetterContract.signer.getTransactionCount();

    // Transaction list
    const transactions = [];

    // Loop and generate transactions
    for (let i = 0; i < artifacts.length; i += chunkSizeParsed) {
      const chunk = artifacts.slice(i, i + chunkSizeParsed);
      transactions.push(
        (
          await vKeySetterContract.batchCommitVerificationKey(
            chunk.map((artifact) => artifact.nullifiers),
            chunk.map((artifact) => artifact.commitments),
            { nonce, ...feeObject },
          )
        ).wait(),
      );
      nonce += 1;
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms
    }

    console.log('GENERATED TRANSACTIONS');

    await Promise.all(transactions);
  });
