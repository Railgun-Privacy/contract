// These are old events from previous implementations of upgradable contracts, inject into exported ABI to allow for parsing of old events

const additions: Record<string, object[]> = {
  'contracts/logic/RailgunSmartWallet.sol:RailgunSmartWallet': [
    {
      anonymous: false,
      inputs: [
        {
          indexed: false,
          internalType: 'uint256',
          name: 'treeNumber',
          type: 'uint256',
        },
        {
          indexed: false,
          internalType: 'uint256',
          name: 'startPosition',
          type: 'uint256',
        },
        {
          indexed: false,
          internalType: 'uint256[]',
          name: 'hash',
          type: 'uint256[]',
        },
        {
          components: [
            {
              internalType: 'uint256[4]',
              name: 'ciphertext',
              type: 'uint256[4]',
            },
            {
              internalType: 'uint256[2]',
              name: 'ephemeralKeys',
              type: 'uint256[2]',
            },
            {
              internalType: 'uint256[]',
              name: 'memo',
              type: 'uint256[]',
            },
          ],
          indexed: false,
          internalType: 'struct RailgunLogic.CommitmentCiphertextLegacy[]',
          name: 'ciphertext',
          type: 'tuple[]',
        },
      ],
      name: 'CommitmentBatch',
      type: 'event',
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: false,
          internalType: 'uint256',
          name: 'treeNumber',
          type: 'uint256',
        },
        {
          indexed: false,
          internalType: 'uint256',
          name: 'startPosition',
          type: 'uint256',
        },
        {
          components: [
            {
              internalType: 'uint256',
              name: 'npk',
              type: 'uint256',
            },
            {
              components: [
                {
                  internalType: 'enum TokenType',
                  name: 'tokenType',
                  type: 'uint8',
                },
                {
                  internalType: 'address',
                  name: 'tokenAddress',
                  type: 'address',
                },
                {
                  internalType: 'uint256',
                  name: 'tokenSubID',
                  type: 'uint256',
                },
              ],
              internalType: 'struct TokenDataLegacy',
              name: 'token',
              type: 'tuple',
            },
            {
              internalType: 'uint120',
              name: 'value',
              type: 'uint120',
            },
          ],
          indexed: false,
          internalType: 'struct CommitmentPreimageLegacy[]',
          name: 'commitments',
          type: 'tuple[]',
        },
        {
          indexed: false,
          internalType: 'uint256[2][]',
          name: 'encryptedRandom',
          type: 'uint256[2][]',
        },
      ],
      name: 'GeneratedCommitmentBatch',
      type: 'event',
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: false,
          internalType: 'uint256',
          name: 'treeNumber',
          type: 'uint256',
        },
        {
          indexed: false,
          internalType: 'uint256[]',
          name: 'nullifier',
          type: 'uint256[]',
        },
      ],
      name: 'Nullifiers',
      type: 'event',
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: false,
          internalType: 'uint256',
          name: 'treeNumber',
          type: 'uint256',
        },
        {
          indexed: false,
          internalType: 'uint256',
          name: 'startPosition',
          type: 'uint256',
        },
        {
          components: [
            {
              internalType: 'bytes32',
              name: 'npk',
              type: 'bytes32',
            },
            {
              components: [
                {
                  internalType: 'enum TokenType',
                  name: 'tokenType',
                  type: 'uint8',
                },
                {
                  internalType: 'address',
                  name: 'tokenAddress',
                  type: 'address',
                },
                {
                  internalType: 'uint256',
                  name: 'tokenSubID',
                  type: 'uint256',
                },
              ],
              internalType: 'struct TokenData',
              name: 'token',
              type: 'tuple',
            },
            {
              internalType: 'uint120',
              name: 'value',
              type: 'uint120',
            },
          ],
          indexed: false,
          internalType: 'struct CommitmentPreimage[]',
          name: 'commitments',
          type: 'tuple[]',
        },
        {
          components: [
            {
              internalType: 'bytes32[3]',
              name: 'encryptedBundle',
              type: 'bytes32[3]',
            },
            {
              internalType: 'bytes32',
              name: 'shieldKey',
              type: 'bytes32',
            },
          ],
          indexed: false,
          internalType: 'struct ShieldCiphertext[]',
          name: 'shieldCiphertext',
          type: 'tuple[]',
        },
      ],
      name: 'Shield',
      type: 'event',
    },
  ],
};

export { additions };
