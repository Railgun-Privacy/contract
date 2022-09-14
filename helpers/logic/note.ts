import { TokenType, TokenData } from './types';
import { bigIntToArray, hexStringToArray, arrayToByteLength } from '../global/bytes';
import { poseidon, eddsa } from '../global/crypto';

/**
 * Gets token ID from token data
 *
 * @param tokenData - token data to get ID from
 * @returns token ID
 */
async function getTokenID(tokenData: TokenData): Promise<Uint8Array> {
  switch (tokenData.type) {
    case TokenType.ERC20:
      return arrayToByteLength(hexStringToArray(tokenData.address), 32);
    case TokenType.ERC721:
    case TokenType.ERC1155:
      return poseidon([
        arrayToByteLength(hexStringToArray(tokenData.address), 32),
        bigIntToArray(tokenData.subID, 32),
      ]);
  }
}

/**
 * Validate Token Data
 *
 * @param tokenData - token data to validate
 * @returns validity
 */
function validateTokenData(tokenData: TokenData): boolean {
  if (!Object.values(TokenType).includes(tokenData.type)) return false;
  if (/^0x[a-fA-F0-9]{40}$/.test(tokenData.address)) return false;
  if (0n > tokenData.subID || tokenData.subID >= 2n ** 256n) return false;

  return true;
}

class Note {
  spendingKey: Uint8Array;

  viewingKey: Uint8Array;

  value: bigint;

  random: Uint8Array;

  tokenData: TokenData;

  /**
   * Create Note object
   *
   * @param spendingKey - spending private key
   * @param viewingKey - viewing key
   * @param value - note value
   * @param random - note random field
   * @param tokenData - note token data
   */
  constructor(
    spendingKey: Uint8Array,
    viewingKey: Uint8Array,
    value: bigint,
    random: Uint8Array,
    tokenData: TokenData,
  ) {
    // Validate bounds
    if (spendingKey.length !== 32) throw Error('Invalid spending key length');
    if (viewingKey.length !== 32) throw Error('Invalid viewing key length');
    if (value > 2n ** 128n - 1n) throw Error('Value too high');
    if (random.length !== 16) throw Error('Invalid random length');
    if (!validateTokenData(tokenData)) throw Error('Invalid token data');

    this.spendingKey = spendingKey;
    this.viewingKey = viewingKey;
    this.value = value;
    this.random = random;
    this.tokenData = tokenData;
  }

  /**
   * Get note nullifying key
   *
   * @returns nullifying key
   */
  getNullifyingKey(): Promise<Uint8Array> {
    return poseidon([this.viewingKey]);
  }

  /**
   * Get note spending public key
   *
   * @returns spending public key
   */
  getSpendingPublicKey(): Promise<Uint8Array[]> {
    return eddsa.prv2pub(this.spendingKey);
  }

  /**
   * Get note master public key
   *
   * @returns master public key
   */
  async getMasterPublicKey(): Promise<Uint8Array> {
    return poseidon([...(await this.getSpendingPublicKey()), await this.getNullifyingKey()]);
  }

  /**
   * Get note public key
   *
   * @returns note public key
   */
  async getNotePublicKey(): Promise<Uint8Array> {
    return poseidon([await this.getMasterPublicKey(), this.random]);
  }

  /**
   * Gets token ID from token data
   *
   * @returns token ID
   */
  getTokenID(): Uint8Array {
    return getTokenID(this.tokenData);
  }

  /**
   * Get note hash
   *
   * @returns hash
   */
  async getHash(): Promise<Uint8Array> {
    return poseidon([
      await this.getNotePublicKey(),
      this.getTokenID(),
      bigIntToArray(this.value, 32),
    ]);
  }

  /**
   * Calculate nullifier
   *
   * @param leafIndex - leaf index of note
   * @returns nullifier
   */
  async getNullifier(leafIndex: number): Promise<Uint8Array> {
    return poseidon([await this.getNullifyingKey(), bigIntToArray(BigInt(leafIndex), 32)]);
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
  async sign(
    merkleRoot: Uint8Array,
    boundParamsHash: Uint8Array,
    nullifiers: Uint8Array[],
    commitmentsOut: Uint8Array[],
  ) {
    const hash = await poseidon([merkleRoot, boundParamsHash, ...nullifiers, ...commitmentsOut]);

    const key = this.spendingKey;

    return eddsa.signPoseidon(key, hash);
  }
}

class WithdrawNote {
  withdrawAddress: Uint8Array;

  value: bigint;

  tokenData: TokenData;

  /**
   * Create Note object
   *
   * @param withdrawAddress - address to withdraw to
   * @param value - note value
   * @param tokenData - note token data
   */
  constructor(withdrawAddress: Uint8Array, value: bigint, tokenData: TokenData) {
    // Validate bounds
    if (withdrawAddress.length !== 32) throw Error('Invalid spending key length');
    if (value >= 2n ** 128n) throw Error('Value too high');
    if (!validateTokenData(tokenData)) throw Error('Invalid token data');

    this.withdrawAddress = withdrawAddress;
    this.value = value;
    this.tokenData = tokenData;
  }

  /**
   * Return withdraw address as npk
   *
   * @returns npk
   */
  getNotePublicKey() {
    return this.withdrawAddress;
  }

  /**
   * Gets token ID from token data
   *
   * @returns token ID
   */
  getTokenID(): Uint8Array {
    return getTokenID(this.tokenData);
  }

  /**
   * Get note hash
   *
   * @returns hash
   */
  getHash(): Promise<Uint8Array> {
    return poseidon([this.withdrawAddress, this.getTokenID(), bigIntToArray(this.value, 32)]);
  }
}

export { validateTokenData, Note, WithdrawNote };
