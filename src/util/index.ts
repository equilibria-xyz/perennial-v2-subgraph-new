import { BigInt, Bytes } from '@graphprotocol/graph-ts'

export function bigIntToBytes(value: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromU64(value.toU64()))
}

export function magnitude(maker: BigInt, long: BigInt, short: BigInt): BigInt {
  return max(max(maker, long), short)
}

function max(a: BigInt, b: BigInt): BigInt {
  return a.gt(b) ? a : b
}
