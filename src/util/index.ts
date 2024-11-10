import { BigInt, ByteArray, Bytes } from '@graphprotocol/graph-ts'

import { mul } from './big6Math'
import { MarketAccount } from '../../generated/schema'
import { IdSeparatorBytes } from './constants'

export function bigIntToBytes(value: BigInt): Bytes {
  const uint8Array = changetype<Uint8Array>(value)
  const byteArray = changetype<ByteArray>(uint8Array)
  return Bytes.fromByteArray(byteArray)
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

export function isTaker(marketAccount: MarketAccount): boolean {
  const side_ = side(marketAccount.maker, marketAccount.long, marketAccount.short)

  return side_ === 'long' || side_ === 'short'
}

export function timestampToBucket(timestamp: BigInt, bucket: string): BigInt {
  let bucketTime: BigInt

  if (bucket === 'daily') {
    bucketTime = BigInt.fromI32(86400)
  } else if (bucket === 'hourly') {
    bucketTime = BigInt.fromI32(3600)
  } else if (bucket === 'weekly') {
    bucketTime = BigInt.fromI32(86400 * 7)
  } else if (bucket === 'all') {
    bucketTime = BigInt.zero()
  } else {
    throw new Error('Invalid bucket ' + bucket)
  }

  if (bucketTime.equals(BigInt.zero())) return bucketTime
  return timestamp.div(bucketTime).times(bucketTime)
}

export function triggerOrderId(address: Bytes, nonce: BigInt): Bytes {
  return address.concat(IdSeparatorBytes).concat(bigIntToBytes(nonce))
}
