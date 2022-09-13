export enum TokenType {
  'ERC20' = 0,
  'ERC721' = 1,
  'ERC1155' = 2,
}

export interface TokenData {
  type: TokenType;
  address: string;
  subID: bigint;
}
