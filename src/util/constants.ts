import { BigInt, Bytes } from '@graphprotocol/graph-ts'

export const IdSeparatorBytes = Bytes.fromUTF8(':')
export const ZeroAddress = Bytes.fromHexString('0x0000000000000000000000000000000000000000')
export const SecondsPerYear = BigInt.fromI64(31536000)
export const Buckets = ['hourly', 'daily', 'weekly', 'all']
