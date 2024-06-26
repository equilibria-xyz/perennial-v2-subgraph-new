import { BigInt, Bytes } from '@graphprotocol/graph-ts'

import { mul } from './big6Math'

export function bigIntToBytes(value: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromU64(value.toU64()))
}

export function positionMagnitude(maker: BigInt, long: BigInt, short: BigInt): BigInt {
  return max(max(maker, long), short)
}

// Returns the size of an *account* order where only one side is non-zero
export function accountOrderSize(maker: BigInt, long: BigInt, short: BigInt): BigInt {
  return maker.plus(long).plus(short)
}

function max(a: BigInt, b: BigInt): BigInt {
  return a.gt(b) ? a : b
}

export function notional(size: BigInt, price: BigInt): BigInt {
  return mul(size, price).abs()
}

export function side(maker: BigInt, long: BigInt, short: BigInt): string {
  if (maker.gt(BigInt.zero())) return 'maker'
  if (long.gt(BigInt.zero())) return 'long'
  if (short.gt(BigInt.zero())) return 'short'
  return 'none'
}
