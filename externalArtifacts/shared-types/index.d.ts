export declare type JsonFragmentType = {
  readonly name?: string;
  readonly indexed?: boolean;
  readonly type?: string;
  readonly internalType?: any;
  readonly components?: ReadonlyArray<JsonFragmentType>;
};
export declare type ABIFragment = {
  readonly name?: string;
  readonly type?: string;
  readonly anonymous?: boolean;
  readonly payable?: boolean;
  readonly constant?: boolean;
  readonly stateMutability?: string;
  readonly inputs?: ReadonlyArray<JsonFragmentType>;
  readonly outputs?: ReadonlyArray<JsonFragmentType>;
  readonly gas?: string;
};
export declare type Artifact = {
  abi: ABIFragment[];
  bytecode: string;
};
