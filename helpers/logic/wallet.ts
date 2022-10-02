import { TransactionResponse } from '@ethersproject/providers';
import { RailgunLogic } from '../../typechain-types';
import { GeneratedCommitmentBatchEventObject } from '../../typechain-types/contracts/logic/RailgunLogic';
import { hexStringToArray } from '../global/bytes';
import { aes } from '../global/crypto';
import { Note } from './note';

class Wallet {
  spendingKey: Uint8Array;

  viewingKey: Uint8Array;

  notes: Note[] = [];

  /**
   * Railgun Wallet
   *
   * @param spendingKey - Spending key
   * @param viewingKey - Viewing key
   */
  constructor(spendingKey: Uint8Array, viewingKey: Uint8Array) {
    this.spendingKey = spendingKey;
    this.viewingKey = viewingKey;
  }

  /**
   * Gets total balance in wallet
   * 
   * @returns total balance
   */
  get totalBalance() {
    return this.notes
      .map((note) => note.value)
      .reduce((accumulator, noteValue) => accumulator + noteValue);
  }

  /**
   * Scans transaction for commitments and nullifiers
   *
   * @param transaction - transaction to scan
   * @param contract - contract to parse events from
   * @returns complete
   */
  async scanTX(transaction: TransactionResponse, contract: RailgunLogic) {
    // Wait for transaction receipt
    const transactionReceipt = await transaction.wait();

    // Loop through each log and parse
    await Promise.all(
      // eslint-disable-next-line @typescript-eslint/require-await
      transactionReceipt.logs.map(async (log) => {
        // Check if log is log of contract
        if (log.address === contract.address) {
          // Parse log
          const parsedLog = contract.interface.parseLog(log);

          // Check log type
          if (parsedLog.name === 'GeneratedCommitmentBatch') {
            // Type cast to GeneratedCommitmentBatchEventObject
            const args = parsedLog.args as unknown as GeneratedCommitmentBatchEventObject;

            // Loop through each deposit
            args.encryptedRandom.forEach((encryptedRandom, index) => {
              // Try to decrypt
              try {
                // Decrypt will throw on failure
                const decrypted = aes.gcm.decrypt(
                  encryptedRandom.map((element) => hexStringToArray(element.toHexString())),
                  this.viewingKey,
                );

                // Push note to note storage
                this.notes.push(
                  new Note(
                    this.spendingKey,
                    this.viewingKey,
                    args.commitments[index].value.toBigInt(),
                    decrypted[0],
                    {
                      tokenType: args.commitments[index].token.tokenType,
                      tokenAddress: args.commitments[index].token.tokenAddress,
                      tokenSubID: args.commitments[index].token.tokenSubID.toBigInt(),
                    },
                  ),
                );
              } catch {}
            });
          }
        }
      }),
    );
  }
}

export { Wallet };
