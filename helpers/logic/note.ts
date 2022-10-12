import {
  bigIntToArray,
  hexStringToArray,
  arrayToByteLength,
  combine,
  chunk,
  padToLength,
  railgunBase37,
  arrayToBigInt,
  arrayToHexString,
} from '../global/bytes';
import { hash, edBabyJubJub, aes, ed25519, randomBytes } from '../global/crypto';

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

export interface DepositCiphertext {
  encryptedRandom: [Uint8Array, Uint8Array];
  ephemeralKey: Uint8Array;
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

  memo: string;

  /**
   * Railgun Note
   *
   * @param spendingKey - spending private key
   * @param viewingKey - viewing key
   * @param value - note value
   * @param random - note random field
   * @param tokenData - note token data
   * @param memo - note memo
   */
  constructor(
    spendingKey: Uint8Array,
    viewingKey: Uint8Array,
    value: bigint,
    random: Uint8Array,
    tokenData: TokenData,
    memo: string,
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
    this.memo = memo;
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
    return edBabyJubJub.privateKeyToPublicKey(this.spendingKey);
  }

  /**
   * Get note viewing public key
   *
   * @returns viewing public key
   */
  getViewingPublicKey(): Promise<Uint8Array> {
    return ed25519.privateKeyToPublicKey(this.viewingKey);
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

    return edBabyJubJub.signPoseidon(key, sighash);
  }

  /**
   * Encrypts random value
   *
   * @returns Encrypted random value
   */
  get encryptedRandom(): [Uint8Array, Uint8Array] {
    return aes.gcm.encrypt([this.random], this.viewingKey) as [Uint8Array, Uint8Array];
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
   * Encrypts random value for deposit
   *
   * @returns encrypted random bundle
   */
  async encryptForDeposit(): Promise<DepositCiphertext> {
    // Generate a throwaway viewing key
    const ephemeralViewingPrivateKey = randomBytes(32);
    const ephemeralViewingPublicKey = await ed25519.privateKeyToPublicKey(
      ephemeralViewingPrivateKey,
    );

    // Get shared key
    const sharedKey = ed25519.getSharedKey(
      ephemeralViewingPrivateKey,
      await this.getViewingPublicKey(),
    );

    // Encrypt random
    const encryptedRandom = aes.gcm.encrypt([this.random], sharedKey) as [Uint8Array, Uint8Array];

    return {
      encryptedRandom,
      ephemeralKey: ephemeralViewingPublicKey,
    };
  }

  /**
   * Generates encrypted commitment bundle
   *
   * @param senderViewingPrivateKey - sender's viewing private key
   * @param blind - blind sender from receiver
   * @returns Ciphertext
   */
  async encrypt(
    senderViewingPrivateKey: Uint8Array,
    blind: boolean,
  ): Promise<CommitmentCiphertext> {
    // For contract tests always use output type of 0
    const outputType = 0n;

    // For contract tests always use this fixed application identifier
    const applicationIdentifier = railgunBase37.encode('railgun tests');

    // Get sender public key
    const senderViewingPublicKey = await ed25519.privateKeyToPublicKey(senderViewingPrivateKey);

    // Get sender random, set to 0 is not blinding
    const senderRandom = blind ? randomBytes(16) : new Uint8Array(15);

    // Blind keys
    const blindedKeys = ed25519.railgunKeyExchange.blindKeys(
      senderViewingPublicKey,
      await this.getViewingPublicKey(),
      this.random,
      senderRandom,
    );

    // Get shared key
    const sharedKey = ed25519.getSharedKeyLegacy(
      senderViewingPrivateKey,
      blindedKeys.blindedReceiverPublicKey,
    );

    // Encode memo text
    const memo = chunk(new TextEncoder().encode(this.memo), 32);

    // Right-pad last memo chunk to 32 bytes if it exists
    if (memo.length > 0) {
      memo[memo.length - 1] = padToLength(memo[memo.length - 1], 32, 'right');
    }

    // Encrypt shared ciphertext
    const encryptedSharedBundle = aes.gcm.encrypt(
      [
        await this.getMasterPublicKey(),
        combine([this.random, bigIntToArray(this.value, 16)]),
        await this.getTokenID(),
        ...memo,
      ],
      sharedKey,
    );

    // Calculate annotation data
    const annotationData = [
      combine([bigIntToArray(outputType, 1), senderRandom]),
      combine([new Uint8Array(16), applicationIdentifier]),
    ];

    // Encrypt sender ciphertext
    const encryptedSenderBundle = aes.ctr.encrypt(annotationData, senderViewingPrivateKey);

    // Return formatted commitment bundle
    return {
      ciphertext: [
        encryptedSharedBundle[0],
        encryptedSharedBundle[1],
        encryptedSharedBundle[2],
        encryptedSharedBundle[3],
      ],
      ephemeralKeys: [blindedKeys.blindedSenderPublicKey, blindedKeys.blindedReceiverPublicKey],
      memo: [
        combine([encryptedSenderBundle[0], encryptedSenderBundle[1]]),
        encryptedSenderBundle[2],
        ...encryptedSharedBundle.slice(4),
      ],
    };
  }

  /**
   * Decrypts note from encrypted bundle
   *
   * @param expectedHash - expected hash of note
   * @param encrypted - encrypted commitment bundle
   * @param viewingKey - viewing private key to try decrypting for
   * @param spendingKey - spending private key to use in decrypted note
   * @param tokenData - token data to use in decrypted note
   * @returns decrypted note or undefined if decryption failed,
   * spender key doesn't match, or token data doesn't match
   */
  static async decrypt(
    expectedHash: Uint8Array,
    encrypted: CommitmentCiphertext,
    viewingKey: Uint8Array,
    spendingKey: Uint8Array,
    tokenData: TokenData,
  ): Promise<Note | undefined> {
    // Reconstruct encrypted shared bundle
    const encryptedSharedBundle: Uint8Array[] = [
      ...encrypted.ciphertext,
      ...encrypted.memo.slice(2),
    ];

    let sharedBundle: Uint8Array[];

    // Try to decrypt encrypted shared bundle
    try {
      // Get shared key
      const sharedKey = ed25519.getSharedKeyLegacy(viewingKey, encrypted.ephemeralKeys[0]);

      // Decrypt
      sharedBundle = aes.gcm.decrypt(encryptedSharedBundle, sharedKey);
    } catch {
      return undefined;
    }

    // Decode memo
    const memo =
      sharedBundle.length > 3 ? new TextDecoder().decode(combine(sharedBundle.slice(3))) : '';

    // Construct note
    const note = new Note(
      spendingKey,
      viewingKey,
      arrayToBigInt(sharedBundle[1].slice(16, 32)),
      sharedBundle[1].slice(0, 16),
      tokenData,
      memo.replace(/\u0000/g, ''),
    );

    // If hash matches return note
    if (arrayToHexString(await note.getHash(), false) === arrayToHexString(expectedHash, false))
      return note;

    // Return undefined if hash doesn't match
    return undefined;
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

  /**
   * Return dummy ciphertext
   *
   * @returns Dummy ciphertext
   */
  encrypt(): CommitmentCiphertext {
    return {
      ciphertext: [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)],
      ephemeralKeys: [new Uint8Array(32), new Uint8Array(32)],
      memo: [],
    };
  }
}

export { getTokenID, validateTokenData, Note, WithdrawNote };
