/* eslint-disable max-classes-per-file */
import {ethers} from 'hardhat';
import {poseidon, eddsa} from 'circomlibjs';
import {toBufferBE} from 'bigint-buffer';
import {privateKeyToPublicKey} from './babyjubjub';
import {encryptAESGCM} from './crypto';

export class Note {
  private spendingKey: bigint;
  private viewingKey: bigint;

  value: bigint;
  random: bigint;
  token: bigint;

  /**
   * Create Note object
   *
   * @param {bigint} spendingKey - spending private key
   * @param {bigint} viewingKey - viewing key
   * @param {bigint} value - note value
   * @param {bigint} random - note random field
   * @param {bigint} token - note token
   */
  constructor(
    spendingKey: bigint,
    viewingKey: bigint,
    value: bigint,
    random: bigint,
    token: bigint
  ) {
    this.spendingKey = spendingKey;
    this.viewingKey = viewingKey;
    this.value = value;
    this.random = random;
    this.token = token;
  }

  /**
   * Get note nullifying key
   *
   * @returns nullifying key
   */
  get nullifyingKey(): bigint {
    return poseidon([this.viewingKey]);
  }

  /**
   * Get note spending public key
   *
   * @returns spending public key
   */
  get spendingPublicKey(): [bigint, bigint] {
    return privateKeyToPublicKey(this.spendingKey);
  }

  /**
   * Get note master public key
   *
   * @returns master public key
   */
  get masterPublicKey(): bigint {
    return poseidon([...this.spendingPublicKey, this.nullifyingKey]);
  }

  /**
   * Get note public key
   *
   * @returns note public key
   */
  get notePublicKey(): bigint {
    return poseidon([this.masterPublicKey, this.random]);
  }

  /**
   * Get note hash
   *
   * @returns hash
   */
  get hash(): bigint {
    return poseidon([this.notePublicKey, this.token, this.value]);
  }

  /**
   * Calculate nullifier
   *
   * @param leafIndex - leaf index of note
   * @returns nullifier
   */
  getNullifier(leafIndex: bigint): bigint {
    return poseidon([this.nullifyingKey, leafIndex]);
  }

  /**
   * Sign a transaction
   *
   * @param merkleRoot - transaction merkle root
   * @param boundParamsHash - transaction bound parameters hash
   * @param nullifiers - transaction nullifiers
   * @param commitmentsOut - transaction commitments
   * @returns signature
   */
  sign(
    merkleRoot: bigint,
    boundParamsHash: bigint,
    nullifiers: bigint[],
    commitmentsOut: bigint[]
  ): [bigint, bigint, bigint] {
    const hash = poseidon([merkleRoot, boundParamsHash, ...nullifiers, ...commitmentsOut]);

    const key = Buffer.from(ethers.BigNumber.from(this.spendingKey).toHexString().slice(2), 'hex');

    const sig = eddsa.signPoseidon(key, hash);

    return [...sig.R8, sig.S];
  }

  /**
   * Encrypts note random
   *
   * @returns encrypted random data
   */
  async encryptRandom(): Promise<Buffer[]> {
    return encryptAESGCM([toBufferBE(this.random, 16)], toBufferBE(this.viewingKey, 32));
  }
}

export class WithdrawNote {
  private withdrawAddress: bigint;
  value: bigint;
  token: bigint;

  /**
   * Create Note object
   *
   * @param withdrawAddress - address to withdraw to
   * @param value - note value
   * @param token - note token
   */
  constructor(withdrawAddress: bigint, value: bigint, token: bigint) {
    this.withdrawAddress = withdrawAddress;
    this.value = value;
    this.token = token;
  }

  /**
   * Return withdraw address as npk
   *
   * @returns {bigint} npk
   */
  get notePublicKey() {
    return this.withdrawAddress;
  }

  /**
   * Get note hash
   *
   * @returns {bigint} hash
   */
  get hash() {
    return poseidon([this.withdrawAddress, this.token, this.value]);
  }
}
