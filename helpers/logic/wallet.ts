import { TransactionResponse } from '@ethersproject/providers';
import { RailgunLogic } from '../../typechain-types';
import {
  CommitmentBatchEventObject,
  GeneratedCommitmentBatchEventObject,
} from '../../typechain-types/contracts/logic/RailgunLogic';
import { arrayToHexString, hexStringToArray } from '../global/bytes';
import { aes, randomBytes } from '../global/crypto';
import { MerkleTree } from './merkletree';
import { getTokenID, Note, TokenData } from './note';

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
  get totalBalance(): bigint {
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
      transactionReceipt.logs.map(async (log) => {
        // Check if log is log of contract
        if (log.address === contract.address) {
          // Parse log
          const parsedLog = contract.interface.parseLog(log);

          // Check log type
          if (parsedLog.name === 'GeneratedCommitmentBatch') {
            // Type cast to GeneratedCommitmentBatchEventObject
            const args = parsedLog.args as unknown as GeneratedCommitmentBatchEventObject;

            const startPosition = args.startPosition.toNumber();

            // Loop through each deposit
            args.encryptedRandom.forEach((encryptedRandom, index) => {
              // Try to decrypt
              try {
                // Decrypt will throw on failure
                const decrypted = aes.gcm.decrypt(
                  encryptedRandom.map((element) => hexStringToArray(element.toHexString())),
                  this.viewingKey,
                );

                // Insert into note array in same index as merkle tree
                this.notes[startPosition + index] = new Note(
                  this.spendingKey,
                  this.viewingKey,
                  args.commitments[index].value.toBigInt(),
                  decrypted[0],
                  {
                    tokenType: args.commitments[index].token.tokenType,
                    tokenAddress: args.commitments[index].token.tokenAddress,
                    tokenSubID: args.commitments[index].token.tokenSubID.toBigInt(),
                  },
                );
              } catch {}
            });
          } else if (parsedLog.name === 'CommitmentBatch') {
            // Type cast to CommitmentBatchEventObject
            const args = parsedLog.args as unknown as CommitmentBatchEventObject;

            // Get start position
            const startPosition = args.startPosition.toNumber();

            // Loop through each note
            args.ciphertext.forEach((ciphertext, index) => {
              console.log(ciphertext);
            });
          }
        }
      }),
    );
  }

  /**
   * Get unspent notes
   *
   * @param merkletree - merkle tree to use as seen nullifiers source
   * @param token - token to get unspent notes for
   * @returns unspent notes
   */
  async getUnspentNotes(merkletree: MerkleTree, token: TokenData): Promise<Note[]> {
    // Get requested token ID as hex
    const tokenID = arrayToHexString(await getTokenID(token), false);

    // Get note nullifiers as hex
    const noteNullifiers = await Promise.all(
      this.notes.map(async (note, index) =>
        arrayToHexString(await note.getNullifier(index), false),
      ),
    );

    // Get note token IDs as hex
    const noteTokenIDs = await Promise.all(
      this.notes.map(async (note) => arrayToHexString(await note.getTokenID(), false)),
    );

    // Get seen nullifiers as hex
    const seenNullifiers = merkletree.nullifiers.map((nullifier) =>
      arrayToHexString(nullifier, false),
    );

    // Return notes that haven't had their nullifiers seen and token IDs match
    return this.notes
      .filter((note, index) => !seenNullifiers.includes(noteNullifiers[index]))
      .filter((note, index) => noteTokenIDs[index] === tokenID);
  }

  /**
   * Gets inputs and outputs for a given test circuit
   *
   * @param merkletree - merkle tree to use as seen nullifiers source
   * @param inputs - number of inputs
   * @param outputs - number of outputs
   * @param token - token to get notes for
   * @returns inputs and outputs to use for test
   */
  async getTestTransactionInputs(
    merkletree: MerkleTree,
    inputs: number,
    outputs: number,
    token: TokenData,
  ): Promise<{ inputs: Note[]; outputs: Note[] }> {
    // Get unspent notes
    const unspentNotes = await this.getUnspentNotes(merkletree, token);

    // If unspent notes doesn't have enough notes to satisfy the requested number of inputs throw
    if (unspentNotes.length < inputs) throw new Error('Not enough inputs');

    // Get first 'inputs' number of notes and push to inputs array
    const inputNotes: Note[] = unspentNotes.slice(0, inputs);

    // Get sum of inputs values
    const inputTotal = inputNotes.map((note) => note.value).reduce((right, left) => right + left);

    // Divide input total by outputs
    const outputPerNote = inputTotal / BigInt(outputs);

    // Get remainder
    const outputRemainder = inputTotal % BigInt(outputs);

    // Get output per note array - add remainder to first note
    const outputNoteValues: bigint[] = new Array(outputs).fill(outputPerNote) as bigint[];
    outputNoteValues[0] += outputRemainder;

    // Get output notes
    const outputNotes: Note[] = outputNoteValues.map(
      (value) => new Note(this.spendingKey, this.viewingKey, value, randomBytes(16), token),
    );

    return {
      inputs: inputNotes,
      outputs: outputNotes,
    };
  }
}

export { Wallet };
