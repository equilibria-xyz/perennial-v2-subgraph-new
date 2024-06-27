import { BigInt } from '@graphprotocol/graph-ts'

export const BASE = BigInt.fromI32(10).pow(6)

export function mul(a: BigInt, b: BigInt): BigInt {
  return a.times(b).div(BASE)
}

export function mulOut(a: BigInt, b: BigInt): BigInt {
  return _divOut(a.times(b), BASE)
}

export function div(a: BigInt, b: BigInt): BigInt {
  return a.times(BASE).div(b)
}

export function divOut(a: BigInt, b: BigInt): BigInt {
  return sign(a)
    .times(sign(b))
    .times(ceilDiv(a.abs().times(BASE), b.abs()))
}

function _divOut(a: BigInt, b: BigInt): BigInt {
  return sign(a).times(sign(b)).times(ceilDiv(a.abs(), b.abs()))
}

function ceilDiv(a: BigInt, b: BigInt): BigInt {
  return a.isZero() ? BigInt.zero() : a.minus(BigInt.fromI32(1)).div(b).plus(BigInt.fromI32(1))
}

function sign(a: BigInt): BigInt {
  return a.gt(BigInt.zero()) ? BigInt.fromI32(1) : BigInt.fromI32(-1)
}

export function isNeg(a: BigInt): boolean {
  return a.lt(BigInt.zero())
}

export function fromBig18(amount: BigInt, ceil: boolean): BigInt {
  if (ceil) return ceilDiv(amount, BigInt.fromI32(10).pow(12))
  return amount.div(BigInt.fromI32(10).pow(12))
}
