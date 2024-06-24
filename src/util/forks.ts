import { BigInt } from '@graphprotocol/graph-ts'

export function activeForkForNetwork(network: string, currBlock: BigInt): string {
  if (network == 'arbitrum-sepolia') {
    if (currBlock.ge(BigInt.fromI32(41987290))) {
      return 'v2_2'
    }

    return 'v2_1'
  }

  if (network == 'arbitrum-one') {
    if (currBlock.ge(BigInt.fromI32(216721905))) {
      return 'v2_2'
    } else if (currBlock.ge(BigInt.fromI32(171762256))) {
      return 'v2_1'
    } else if (currBlock.ge(BigInt.fromI32(152322202))) {
      return 'v2_0_2'
    }

    return 'v2_0_1'
  }

  return 'v2_2'
}
