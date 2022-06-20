import {BigNumber, Event} from 'ethers';
import {MerkleTree} from './merkletree';
import hre from 'hardhat';
import {Note, WithdrawNote} from './note';
import {getFee} from './transaction';
import {genRandomPoint} from './babyjubjub';
import {CommitmentPreimageArgs} from '../types/types';

const {ethers} = hre;

export class NoteRegistry {
  commitments: bigint[];
  preimages: Map<bigint, Note | WithdrawNote>;

  /**
   * Create Note Registry
   */
  constructor() {
    this.commitments = new Array(2 ** 16);
    this.preimages = new Map();
  }

  /**
   * Load commitments
   *
   * @param startingIndex - index of first commitment
   * @param commitments - array of commitments
   */
  loadCommitments(startingIndex: number, commitments: bigint[]) {
    this.commitments.splice(startingIndex, startingIndex + commitments.length, ...commitments);
  }

  /**
   * Load notes into map
   *
   * @param notes - notes to lead into registry
   */
  loadNotes(notes: (Note | WithdrawNote)[]) {
    notes.forEach(note => {
      this.preimages.set(note.hash, note);
    });
  }

  /**
   * Adjusts note values by fee and stores in registry
   *
   * @param notes - notes to insert
   * @param feeBP - fee basis points
   * @returns totals: [base, fee]
   */
  loadNotesWithFees(notes: Note[], feeBP: bigint): [bigint, bigint] {
    let totalBase = 0n;
    let totalFee = 0n;

    notes.forEach(note => {
      const [base, fee] = getFee(note.value, true, feeBP);
      // eslint-disable-next-line no-param-reassign
      note.value = base;
      totalBase += base;
      totalFee += fee;

      this.preimages.set(note.hash, note);
    });

    return [totalBase, totalFee];
  }

  /**
   * Parses events and loads to merkle tree if passed in
   *
   * @param transaction - transaction to parse
   * @param merkleTree - (optional) merkle tree to load events into
   */
  parseEvents(
    transaction: any, // TODO-TESTS - remove any
    merkleTree?: MerkleTree
  ) {
    const railgunLogicArtifact = hre.artifacts.readArtifactSync('RailgunLogic');
    const railgunInterface = new ethers.utils.Interface(railgunLogicArtifact.abi);

    transaction.events.forEach((event: Event) => {
      const GeneratedCommitmentBatch = railgunInterface.getEventTopic('GeneratedCommitmentBatch');
      const CommitmentBatch = railgunInterface.getEventTopic('CommitmentBatch');

      if (event.topics[0] === GeneratedCommitmentBatch) {
        const parsedEvent = railgunInterface.parseLog({
          data: event.data,
          topics: event.topics,
        });

        const commitments = parsedEvent.args.commitments.map(
          (commitment: CommitmentPreimageArgs) =>
            new WithdrawNote(
              BigInt(commitment.npk.toHexString()),
              BigInt(commitment.value.toHexString()),
              BigInt(commitment.token.tokenAddress)
            ).hash
        );

        this.loadCommitments(parsedEvent.args.startPosition.toNumber(), commitments);

        merkleTree?.loadToPosition(parsedEvent.args.startPosition.toNumber(), commitments);
      } else if (event.topics[0] === CommitmentBatch) {
        const parsedEvent = railgunInterface.parseLog({
          data: event.data,
          topics: event.topics,
        });

        const commitments = parsedEvent.args.hash.map((hash: BigNumber) =>
          BigInt(hash.toHexString())
        );

        this.loadCommitments(parsedEvent.args.startPosition.toNumber(), commitments);

        merkleTree?.loadToPosition(parsedEvent.args.startPosition.toNumber(), commitments);
      }
    });
  }

  /**
   * Generates a test vector set of notes
   *
   * @param numNullifiers - nullifier count
   * @param numCommitments - commitments count
   * @param spendingKey - note spending key
   * @param viewingKey - note viewing key
   * @returns [input notes, output notes]
   */
  getNotes(
    numNullifiers: number,
    numCommitments: number,
    spendingKey: bigint,
    viewingKey: bigint
  ): [Note[], (Note | WithdrawNote)[]] {
    const entries = this.preimages.entries();
    const inputs: Note[] = [];

    let total = 0n;

    while (inputs.length < numNullifiers) {
      const [hash, note] = entries.next().value;
      inputs.push(note);
      this.preimages.delete(hash);
      total += note.value;
    }

    const outAmounts = total / BigInt(numCommitments);
    const remainder = total % BigInt(numCommitments);

    const outputs = new Array(numCommitments)
      .fill(1)
      .map(() => new Note(spendingKey, viewingKey, outAmounts, genRandomPoint(), inputs[0].token));

    outputs[outputs.length - 1].value += remainder;

    return [inputs, outputs];
  }

  /**
   * Generates a test vector set of notes for withdraws
   *
   * @param address - withdraw address
   * @param nullifiers - nullifier count
   * @param commitments - commitments count
   * @param spendingKey - note spending key
   * @param viewingKey - note viewing key
   * @param feeBP - fee basis points
   * @returns input notes, output notes, base, fee
   */
  getNotesWithdraw(
    address: string,
    nullifiers: number,
    commitments: number,
    spendingKey: bigint,
    viewingKey: bigint,
    feeBP: bigint
  ): [Note[], (Note | WithdrawNote)[], bigint, bigint] {
    const [inputs, outputs] = this.getNotes(nullifiers, commitments, spendingKey, viewingKey);

    outputs[outputs.length - 1] = new WithdrawNote(
      BigInt(address),
      outputs[outputs.length - 1].value,
      outputs[outputs.length - 1].token
    );

    const [base, fee] = getFee(outputs[outputs.length - 1].value, true, feeBP);

    return [inputs, outputs, base, fee];
  }
}
