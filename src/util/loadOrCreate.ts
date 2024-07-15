import { Bytes, BigInt, Address } from '@graphprotocol/graph-ts'
import { IdSeparatorBytes } from './constants'
import { bigIntToBytes } from '.'
import {
  MarketAccumulator as MarketAccumulatorStore,
  MarketAccumulation as MarketAccumulationStore,
  MarketAccountAccumulator as MarketAccountAccumulatorStore,
  MarketAccountAccumulation as MarketAccountAccumulationStore,
  MarketAccount,
  Market,
  ProtocolAccumulation as ProtocolAccumulationStore,
} from '../../generated/schema'

export function loadOrCreateMarketAccumulation(
  marketId: Bytes,
  bucket: string,
  bucketTimestamp: BigInt,
): MarketAccumulationStore {
  const id = Bytes.fromUTF8(bucket)
    .concat(IdSeparatorBytes)
    .concat(marketId)
    .concat(IdSeparatorBytes)
    .concat(bigIntToBytes(bucketTimestamp))
  let entity = MarketAccumulationStore.load(id)
  if (!entity) {
    entity = new MarketAccumulationStore(id)
    entity.market = marketId
    entity.bucket = bucket
    entity.timestamp = bucketTimestamp
    entity.maker = BigInt.zero()
    entity.long = BigInt.zero()
    entity.short = BigInt.zero()
    entity.makerNotional = BigInt.zero()
    entity.longNotional = BigInt.zero()
    entity.shortNotional = BigInt.zero()
    entity.pnlMaker = BigInt.zero()
    entity.pnlLong = BigInt.zero()
    entity.pnlShort = BigInt.zero()
    entity.fundingMaker = BigInt.zero()
    entity.fundingLong = BigInt.zero()
    entity.fundingShort = BigInt.zero()
    entity.interestMaker = BigInt.zero()
    entity.interestLong = BigInt.zero()
    entity.interestShort = BigInt.zero()
    entity.positionFeeMaker = BigInt.zero()
    entity.exposureMaker = BigInt.zero()
    entity.positionFeeMarket = BigInt.zero()
    entity.fundingMarket = BigInt.zero()
    entity.interestMarket = BigInt.zero()
    entity.exposureMarket = BigInt.zero()
    entity.fundingRateMaker = BigInt.zero()
    entity.fundingRateLong = BigInt.zero()
    entity.fundingRateShort = BigInt.zero()
    entity.interestRateMaker = BigInt.zero()
    entity.interestRateLong = BigInt.zero()
    entity.interestRateShort = BigInt.zero()
    entity.trades = BigInt.zero()
    entity.traders = BigInt.zero()
  }
  return entity
}

export function loadOrCreateMarketAccountAccumulation(
  marketAccount: MarketAccount,
  bucket: string,
  bucketTimestamp: BigInt,
): MarketAccountAccumulationStore {
  const id = Bytes.fromUTF8(bucket)
    .concat(IdSeparatorBytes)
    .concat(marketAccount.id)
    .concat(IdSeparatorBytes)
    .concat(bigIntToBytes(bucketTimestamp))
  let entity = MarketAccountAccumulationStore.load(id)
  if (!entity) {
    entity = new MarketAccountAccumulationStore(id)
    entity.market = marketAccount.market
    entity.account = marketAccount.account
    entity.marketAccount = marketAccount.id
    entity.bucket = bucket
    entity.timestamp = bucketTimestamp
    entity.collateral = BigInt.zero()
    entity.fees = BigInt.zero()
    entity.maker = BigInt.zero()
    entity.long = BigInt.zero()
    entity.short = BigInt.zero()
    entity.makerNotional = BigInt.zero()
    entity.longNotional = BigInt.zero()
    entity.shortNotional = BigInt.zero()
    entity.trades = BigInt.zero()
  }
  return entity
}

export function loadOrCreateProtocolAccumulation(bucket: string, bucketTimestamp: BigInt): ProtocolAccumulationStore {
  const id = Bytes.fromUTF8(bucket).concat(IdSeparatorBytes).concat(bigIntToBytes(bucketTimestamp))
  let entity = ProtocolAccumulationStore.load(id)
  if (!entity) {
    entity = new ProtocolAccumulationStore(id)
    entity.bucket = bucket
    entity.timestamp = bucketTimestamp
    entity.makerNotional = BigInt.zero()
    entity.longNotional = BigInt.zero()
    entity.shortNotional = BigInt.zero()
    entity.pnlMaker = BigInt.zero()
    entity.pnlLong = BigInt.zero()
    entity.pnlShort = BigInt.zero()
    entity.fundingMaker = BigInt.zero()
    entity.fundingLong = BigInt.zero()
    entity.fundingShort = BigInt.zero()
    entity.interestMaker = BigInt.zero()
    entity.interestLong = BigInt.zero()
    entity.interestShort = BigInt.zero()
    entity.positionFeeMaker = BigInt.zero()
    entity.exposureMaker = BigInt.zero()
    entity.positionFeeMarket = BigInt.zero()
    entity.fundingMarket = BigInt.zero()
    entity.interestMarket = BigInt.zero()
    entity.exposureMarket = BigInt.zero()
    entity.trades = BigInt.zero()
    entity.traders = BigInt.zero()
  }
  return entity
}
