import { BigInt, Bytes } from '@graphprotocol/graph-ts'

export function bigIntToBytes(value: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromU64(value.toU64()))
}
