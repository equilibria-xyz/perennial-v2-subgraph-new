import { BigInt } from '@graphprotocol/graph-ts'

export enum Fork {
  v2,
  v2_0_1,
  v2_0_2,
  v2_1,
  v2_2,
  v2_3,
}

export function activeForkForNetwork(network: string, currBlock: BigInt): Fork {
  if (network == 'arbitrum-sepolia') {
    if (currBlock.ge(BigInt.fromI32(41987290))) {
      return Fork.v2_2
    }

    return Fork.v2_1
  }

  if (network == 'arbitrum-one') {
    if (currBlock.ge(BigInt.fromI32(216721905))) {
      return Fork.v2_2
    } else if (currBlock.ge(BigInt.fromI32(171762256))) {
      return Fork.v2_1
    } else if (currBlock.ge(BigInt.fromI32(152322202))) {
      return Fork.v2_0_2
    }

    return Fork.v2_0_1
  }

  return Fork.v2_2
}

export function isV2_2OrLater(network: string, currBlock: BigInt): boolean {
  const fork = activeForkForNetwork(network, currBlock)
  return fork >= Fork.v2_2
}

export function isV2_3OrLater(network: string, currBlock: BigInt): boolean {
  const fork = activeForkForNetwork(network, currBlock)
  return fork >= Fork.v2_3
}
