const MerkleTree = require('./merkletree');
const { Note, WithdrawNote } = require('./note');
const babyjubjub = require('./babyjubjub');
const { getFee } = require('./transaction');

class NoteRegistry {
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
   * @param {number} startingIndex - index of first commitment
   * @param {Array<bigint>} commitments - array of commitments
   */
  loadCommitments(startingIndex, commitments) {
    this.commitments.splice(startingIndex, startingIndex + commitments.length, ...commitments);
  }

  /**
   * Load notes into map
   *
   * @param {Note} notes - notes to lead into registry
   */
  loadNotes(notes) {
    notes.forEach((note) => {
      this.preimages.set(note.hash, note);
    });
  }

  /**
   * Adjusts note values by fee and stores in registry
   *
   * @param {Array<Note>} notes - notes to insert
   * @param {bigint} feeBP - fee basis points
   * @returns {Array<bigint, bigint>} total fees
   */
  loadNotesWithFees(notes, feeBP) {
    let totalBase = 0n;
    let totalFee = 0n;

    notes.forEach((note) => {
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
   * @param {object} transaction - transaction to parse
   * @param {MerkleTree} [merkleTree] - (optional) merkle tree to load events into
   */
  parseEvents(transaction, merkleTree) {
    transaction.events.forEach((event) => {
      if (event.event === 'GeneratedCommitmentBatch') {
        const commitments = event.args.commitments.map((commitment) => (new WithdrawNote(
          BigInt(commitment.npk.toHexString()),
          BigInt(commitment.value.toHexString()),
          BigInt(commitment.token.tokenAddress),
        )).hash);

        this.loadCommitments(event.args.startPosition.toNumber(), commitments);

        merkleTree?.loadToPosition(event.args.startPosition.toNumber(), commitments);
      } else if (event.event === 'CommitmentBatch') {
        const commitments = event.args.hash.map(
          (hash) => BigInt(hash.toHexString()),
        );

        this.loadCommitments(event.args.startPosition.toNumber(), commitments);

        merkleTree?.loadToPosition(event.args.startPosition.toNumber(), commitments);
      }
    });
  }

  /**
   * Generates a test vector set of notes
   *
   * @param {number} nullifiers - nullifier count
   * @param {number} commitments - commitments count
   * @param {bigint} spendingKey - note spending key
   * @param {bigint} viewingKey - note viewing key
   * @returns {Array<Array<Note>, Array<Note>>} input notes, output notes
   */
  getNotes(nullifiers, commitments, spendingKey, viewingKey) {
    const entries = this.preimages.entries();
    const inputs = [];

    let total = 0n;

    while (inputs.length < nullifiers) {
      const [hash, note] = entries.next().value;
      inputs.push(note);
      this.preimages.delete(hash);
      total += note.value;
    }

    const outAmounts = total / BigInt(commitments);
    const remainder = total % BigInt(commitments);

    const outputs = new Array(commitments).fill(1).map(() => new Note(
      spendingKey,
      viewingKey,
      outAmounts,
      babyjubjub.genRandomPoint(),
      inputs[0].token,
    ));

    outputs[outputs.length - 1].value += remainder;

    return [inputs, outputs];
  }

  /**
   * Generates a test vector set of notes for withdraws
   *
   * @param {string} address - withdraw address
   * @param {number} nullifiers - nullifier count
   * @param {number} commitments - commitments count
   * @param {bigint} spendingKey - note spending key
   * @param {bigint} viewingKey - note viewing key
   * @param {bigint} feeBP - fee basis points
   * @returns {Array<Array<Note>, Array<Note>, bigint, bigint>} input notes, output notes, base, fee
   */
  getNotesWithdraw(address, nullifiers, commitments, spendingKey, viewingKey, feeBP) {
    const [inputs, outputs] = this.getNotes(nullifiers, commitments, spendingKey, viewingKey);

    outputs[outputs.length - 1] = new WithdrawNote(
      BigInt(address),
      outputs[outputs.length - 1].value,
      outputs[outputs.length - 1].token,
    );

    const [base, fee] = getFee(outputs[outputs.length - 1].value, true, feeBP);

    return [inputs, outputs, base, fee];
  }
}

module.exports = NoteRegistry;
