module.exports = {
  skipFiles: [
    'logic/Poseidon.sol',
    'teststubs/TokenStubs.sol',
    'teststubs/adapt/MaliciousReentrant.sol',
    'teststubs/adapt/SimpleSwap.sol',
    'teststubs/governance/GovernanceTarget.sol',
    'teststubs/governance/StakingStub.sol',
    'teststubs/governance/arbitrum/ArbInboxStub.sol',
    'teststubs/governance/arbitrum/ArbRetryableTxStub.sol',
    'teststubs/logic/CommitmentsStub.sol',
    'teststubs/logic/RailgunLogicStub.sol',
    'teststubs/logic/RailgunSmartWalletStub.sol',
    'teststubs/logic/SnarkStub.sol',
    'teststubs/logic/TokenBlocklistStub.sol',
    'teststubs/logic/VerifierStub.sol',
    'teststubs/proxy/ProxyTarget.sol',
  ],
};
