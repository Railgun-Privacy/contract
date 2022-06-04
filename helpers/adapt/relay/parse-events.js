/* eslint-disable no-use-before-define */
/* eslint-disable jsdoc/require-jsdoc */

const { ethers } = require('hardhat');
const {
  abi: ABI_RELAY_ADAPT,
} = require('../../../artifacts/contracts/adapt/relay/Relay.sol/RelayAdapt.json');

const RETURN_DATA_STRING_PREFIX = '0x08c379a0';

const getRelayAdaptCallResultError = (receipt) => {
  const iface = new ethers.utils.Interface(ABI_RELAY_ADAPT);
  const topic = iface.getEventTopic('CallResult');
  let results = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const log of receipt.logs) {
    if (log.topics[0] === topic) {
      const parsed = iface.parseLog(log);
      results = parsed.args.callResults.map((callResult) => {
        if (!callResult.success) {
          return {
            success: false,
            error: parseCallResultError(callResult.returnData),
          };
        }
        return {
          success: true,
        };
      });
    }
  }

  if (!results.length) {
    throw new Error('Call Result events not found.');
  }
  const firstErrorResult = results.find((r) => r.error);
  if (firstErrorResult) {
    return firstErrorResult.error;
  }
  return undefined;
};

const parseCallResultError = (returnData) => {
  if (returnData.match(RETURN_DATA_STRING_PREFIX)) {
    const strippedReturnValue = returnData.replace(
      RETURN_DATA_STRING_PREFIX,
      '0x',
    );
    const result = ethers.utils.defaultAbiCoder.decode(
      ['string'],
      strippedReturnValue,
    );
    return result[0];
  }

  return 'Unknown Relay Adapt error.';
};

module.exports = {
  getRelayAdaptCallResultError,
};
