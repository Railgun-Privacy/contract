import { bigIntToArray, hexStringToArray, arrayToByteLength } from '../global/bytes';
import { hash, eddsa, aes } from '../global/crypto';

export enum TokenType {
  'ERC20' = 0,
  'ERC721' = 1,
  'ERC1155' = 2,
}

export interface TokenData {
  tokenType: TokenType;
  tokenAddress: string;
  tokenSubID: bigint;
}

export interface CommitmentCiphertext {
  ciphertext: [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  ephemeralKeys: [Uint8Array, Uint8Array];
  memo: Uint8Array[];
}

export interface CommitmentPreimage {
  npk: Uint8Array;
  token: TokenData;
  value: bigint;
}

/**
 * Gets token ID from token data
 *
 * @param tokenData - token data to get ID from
 * @returns token ID
 */
async function getTokenID(tokenData: TokenData): Promise<Uint8Array> {
  switch (tokenData.tokenType) {
    case TokenType.ERC20:
      return arrayToByteLength(hexStringToArray(tokenData.tokenAddress), 32);
    case TokenType.ERC721:
    case TokenType.ERC1155:
      return hash.poseidon([
        arrayToByteLength(hexStringToArray(tokenData.tokenAddress), 32),
        bigIntToArray(tokenData.tokenSubID, 32),
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
  if (!Object.values(TokenType).includes(tokenData.tokenType)) return false;
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenData.tokenAddress)) return false;
  if (0n > tokenData.tokenSubID || tokenData.tokenSubID >= 2n ** 256n) return false;

  return true;
}

class Note {
  spendingKey: Uint8Array;

  viewingKey: Uint8Array;

  value: bigint;

  random: Uint8Array;

  tokenData: TokenData;

  /**
   * Railgun Note
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
    return hash.poseidon([this.viewingKey]);
  }

  /**
   * Get note spending public key
   *
   * @returns spending public key
   */
  getSpendingPublicKey(): Promise<[Uint8Array, Uint8Array]> {
    return eddsa.prv2pub(this.spendingKey);
  }

  /**
   * Get note master public key
   *
   * @returns master public key
   */
  async getMasterPublicKey(): Promise<Uint8Array> {
    return hash.poseidon([...(await this.getSpendingPublicKey()), await this.getNullifyingKey()]);
  }

  /**
   * Get note public key
   *
   * @returns note public key
   */
  async getNotePublicKey(): Promise<Uint8Array> {
    return hash.poseidon([await this.getMasterPublicKey(), arrayToByteLength(this.random, 32)]);
  }

  /**
   * Gets token ID from token data
   *
   * @returns token ID
   */
  getTokenID(): Promise<Uint8Array> {
    return getTokenID(this.tokenData);
  }

  /**
   * Get note hash
   *
   * @returns hash
   */
  async getHash(): Promise<Uint8Array> {
    return hash.poseidon([
      await this.getNotePublicKey(),
      await this.getTokenID(),
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
    return hash.poseidon([await this.getNullifyingKey(), bigIntToArray(BigInt(leafIndex), 32)]);
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
  ): Promise<[Uint8Array, Uint8Array, Uint8Array]> {
    const sighash = await hash.poseidon([
      merkleRoot,
      boundParamsHash,
      ...nullifiers,
      ...commitmentsOut,
    ]);

    const key = this.spendingKey;

    return eddsa.signPoseidon(key, sighash);
  }

  /**
   * Encrypts random value
   *
   * @returns Encrypted random value
   */
  get encryptedRandom(): [Uint8Array, Uint8Array] {
    return aes.gcm.encrypt(
      [this.random],
      this.viewingKey,
    ) as [Uint8Array, Uint8Array];
  }

  /**
   * Gets commitment preimage
   *
   * @returns Commitment preimage
   */
   async getCommitmentPreimage(): Promise<CommitmentPreimage> {
    return {
      npk: await this.getNotePublicKey(),
      token: this.tokenData,
      value: this.value,
    };
  }

  /**
   * Tries to decrypt note with given keys, returns false if can't decrypt
   *
   * @param encrypted - encrypted note values
   * @returns note or flase
   */
  decrypt(encrypted): false | Note {
    
  }
}

class WithdrawNote {
  withdrawAddress: string;

  value: bigint;

  tokenData: TokenData;

  /**
   * Railgun Withdraw
   *
   * @param withdrawAddress - address to withdraw to
   * @param value - note value
   * @param tokenData - note token data
   */
  constructor(withdrawAddress: string, value: bigint, tokenData: TokenData) {
    // Validate bounds
    if (!/^0x[a-fA-F0-9]{40}$/.test(withdrawAddress)) throw Error('Invalid withdraw address');
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
    return arrayToByteLength(hexStringToArray(this.withdrawAddress), 32);
  }

  /**
   * Gets token ID from token data
   *
   * @returns token ID
   */
  getTokenID(): Promise<Uint8Array> {
    return getTokenID(this.tokenData);
  }

  /**
   * Get note hash
   *
   * @returns hash
   */
  async getHash(): Promise<Uint8Array> {
    return hash.poseidon([
      this.getNotePublicKey(),
      await this.getTokenID(),
      bigIntToArray(this.value, 32),
    ]);
  }

  /**
   * Gets commitment preimage
   *
   * @returns Commitment preimage
   */
  getCommitmentPreimage(): CommitmentPreimage {
    return {
      npk: this.getNotePublicKey(),
      token: this.tokenData,
      value: this.value,
    };
  }
}

export { validateTokenData, Note, WithdrawNote };
