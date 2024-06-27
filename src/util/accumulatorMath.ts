import { BigInt } from '@graphprotocol/graph-ts'
import { MarketAccumulator } from '../../generated/schema'
import { isNeg, mulOut, mul, divOut, div } from './big6Math'

export function accumulatorAccumulated(
  to: MarketAccumulator,
  from: MarketAccumulator,
  size: BigInt,
  side: string,
  subAccumulator: string,
): BigInt {
  let toValue = BigInt.zero()
  // For some reason enum comparison is strange in assembly script so we need to use loose equality
  if (side == 'maker') {
    if (subAccumulator === 'pnl') toValue = to.pnlMaker
    if (subAccumulator === 'funding') toValue = to.fundingMaker
    if (subAccumulator === 'interest') toValue = to.interestMaker
    if (subAccumulator === 'positionFee') toValue = to.positionFeeMaker
    if (subAccumulator === 'exposure') toValue = to.exposureMaker
  } else if (side == 'long') {
    if (subAccumulator === 'pnl') toValue = to.pnlLong
    if (subAccumulator === 'funding') toValue = to.fundingLong
    if (subAccumulator === 'interest') toValue = to.interestLong
  } else if (side == 'short') {
    if (subAccumulator === 'pnl') toValue = to.pnlShort
    if (subAccumulator === 'funding') toValue = to.fundingShort
    if (subAccumulator === 'interest') toValue = to.interestShort
  }

  let fromValue = BigInt.zero()
  if (side == 'maker') {
    if (subAccumulator === 'pnl') fromValue = from.pnlMaker
    if (subAccumulator === 'funding') fromValue = from.fundingMaker
    if (subAccumulator === 'interest') fromValue = from.interestMaker
    if (subAccumulator === 'positionFee') fromValue = from.positionFeeMaker
    if (subAccumulator === 'exposure') fromValue = from.exposureMaker
  } else if (side == 'long') {
    if (subAccumulator === 'pnl') fromValue = from.pnlLong
    if (subAccumulator === 'funding') fromValue = from.fundingLong
    if (subAccumulator === 'interest') fromValue = from.interestLong
  } else if (side == 'short') {
    if (subAccumulator === 'pnl') fromValue = from.pnlShort
    if (subAccumulator === 'funding') fromValue = from.fundingShort
    if (subAccumulator === 'interest') fromValue = from.interestShort
  }

  return _accumulatorAccumulated(toValue, fromValue, size)
}
function _accumulatorAccumulated(value: BigInt, from: BigInt, total: BigInt): BigInt {
  const net = value.minus(from)
  return isNeg(net) ? mulOut(net, total) : mul(net, total)
}

export function accumulatorIncrement(value: BigInt, amount: BigInt, total: BigInt): BigInt {
  if (amount.isZero()) return value

  const distributed = isNeg(amount) ? divOut(amount, total) : div(amount, total)
  return value.plus(distributed)
}
