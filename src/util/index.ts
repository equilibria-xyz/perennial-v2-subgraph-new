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

export function side(maker: BigInt, long: BigInt, short: BigInt): string {
  if (maker.gt(BigInt.zero())) return 'maker'
  if (long.gt(BigInt.zero())) return 'long'
  if (short.gt(BigInt.zero())) return 'short'
  return 'none'
}
