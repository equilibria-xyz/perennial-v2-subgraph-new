import { Bytes, BigInt, Address } from '@graphprotocol/graph-ts'
import { IdSeparatorBytes } from './constants'
import { bigIntToBytes } from '.'
import {
  MarketAccumulation as MarketAccumulationStore,
  MarketAccountAccumulation as MarketAccountAccumulationStore,
  MarketAccount,
  AccountAccumulation as AccountAccumulationStore,
  ProtocolAccumulation as ProtocolAccumulationStore,
  OrderAccumulation as OrderAccumulationStore,
  MarketAccount as MarketAccountStore,
  Account as AccountStore,
} from '../../generated/schema'

export function loadOrCreateAccount(account: Address): AccountStore {
  let accountEntity = AccountStore.load(account)
  if (!accountEntity) {
    accountEntity = new AccountStore(account)
    accountEntity.operators = []
    accountEntity.multiInvokerOperators = []
    accountEntity.save()
  }

  return accountEntity
}

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
    entity.taker = BigInt.zero()
    entity.solver = BigInt.zero()
    entity.makerNotional = BigInt.zero()
    entity.longNotional = BigInt.zero()
    entity.shortNotional = BigInt.zero()
    entity.takerNotional = BigInt.zero()
    entity.solverNotional = BigInt.zero()
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
    entity.accumulation = loadOrCreateOrderAccumulation(
      Bytes.fromUTF8('marketAccount').concat(IdSeparatorBytes).concat(id),
    ).id
    entity.takerAccumulation = loadOrCreateOrderAccumulation(
      Bytes.fromUTF8('marketAccount:taker').concat(IdSeparatorBytes).concat(id),
    ).id
    entity.maker = BigInt.zero()
    entity.long = BigInt.zero()
    entity.short = BigInt.zero()
    entity.taker = BigInt.zero()
    entity.solver = BigInt.zero()
    entity.makerNotional = BigInt.zero()
    entity.longNotional = BigInt.zero()
    entity.shortNotional = BigInt.zero()
    entity.takerNotional = BigInt.zero()
    entity.solverNotional = BigInt.zero()
    entity.trades = BigInt.zero()
    entity.liquidations = BigInt.zero()
    entity.referredMakerNotional = BigInt.zero()
    entity.referredLongNotional = BigInt.zero()
    entity.referredShortNotional = BigInt.zero()
    entity.referredTrades = BigInt.zero()
    entity.referredTraders = BigInt.zero()
    entity.referredSubtractiveFees = BigInt.zero()
    entity.guaranteeReferredLongNotional = BigInt.zero()
    entity.guaranteeReferredShortNotional = BigInt.zero()
    entity.guaranteeReferredTrades = BigInt.zero()
    entity.guaranteeReferredTraders = BigInt.zero()
    entity.guaranteeReferredSubtractiveFees = BigInt.zero()
  }
  return entity
}

export function loadOrCreateAccountAccumulation(
  account: Bytes,
  bucket: string,
  bucketTimestamp: BigInt,
): AccountAccumulationStore {
  const id = Bytes.fromUTF8(bucket)
    .concat(IdSeparatorBytes)
    .concat(account)
    .concat(IdSeparatorBytes)
    .concat(bigIntToBytes(bucketTimestamp))
  let entity = AccountAccumulationStore.load(id)
  if (!entity) {
    entity = new AccountAccumulationStore(id)
    entity.account = account
    entity.bucket = bucket
    entity.timestamp = bucketTimestamp
    entity.accumulation = loadOrCreateOrderAccumulation(
      Bytes.fromUTF8('account').concat(IdSeparatorBytes).concat(id),
    ).id
    entity.takerAccumulation = loadOrCreateOrderAccumulation(
      Bytes.fromUTF8('account:taker').concat(IdSeparatorBytes).concat(id),
    ).id
    entity.makerNotional = BigInt.zero()
    entity.longNotional = BigInt.zero()
    entity.shortNotional = BigInt.zero()
    entity.takerNotional = BigInt.zero()
    entity.solverNotional = BigInt.zero()
    entity.trades = BigInt.zero()
    entity.liquidations = BigInt.zero()
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
    entity.takerNotional = BigInt.zero()
    entity.solverNotional = BigInt.zero()
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

export function loadOrCreateOrderAccumulation(id: Bytes): OrderAccumulationStore {
  let entity = OrderAccumulationStore.load(id)
  if (!entity) {
    entity = new OrderAccumulationStore(id)

    entity.collateral_accumulation = BigInt.zero()
    entity.fee_accumulation = BigInt.zero()

    entity.collateral_subAccumulation_offset = BigInt.zero()
    entity.collateral_subAccumulation_pnl = BigInt.zero()
    entity.collateral_subAccumulation_funding = BigInt.zero()
    entity.collateral_subAccumulation_interest = BigInt.zero()
    entity.collateral_subAccumulation_makerPositionFee = BigInt.zero()
    entity.collateral_subAccumulation_makerExposure = BigInt.zero()
    entity.collateral_subAccumulation_priceOverride = BigInt.zero()

    entity.fee_subAccumulation_trade = BigInt.zero()
    entity.fee_subAccumulation_settlement = BigInt.zero()
    entity.fee_subAccumulation_liquidation = BigInt.zero()
    entity.fee_subAccumulation_additive = BigInt.zero()
    entity.fee_subAccumulation_triggerOrder = BigInt.zero()

    entity.metadata_subtractiveFee = BigInt.zero()
    entity.metadata_solverFee = BigInt.zero()
    entity.metadata_net = BigInt.zero()

    entity.save()
  }

  return entity
}
export function buildMarketAccountEntityId(market: Address, account: Address): Bytes {
  return market.concat(IdSeparatorBytes).concat(account)
}
export function loadOrCreateMarketAccount(market: Address, account: Address): MarketAccountStore {
  const marketAccountEntityId = buildMarketAccountEntityId(market, account)
  let marketAccountEntity = MarketAccountStore.load(marketAccountEntityId)
  if (!marketAccountEntity) {
    marketAccountEntity = new MarketAccountStore(marketAccountEntityId)
    marketAccountEntity.account = loadOrCreateAccount(account).id
    marketAccountEntity.market = market
    marketAccountEntity.positionNonce = BigInt.zero()
    marketAccountEntity.latestVersion = BigInt.zero()
    marketAccountEntity.currentVersion = BigInt.zero()
    marketAccountEntity.latestOrderId = BigInt.zero()
    marketAccountEntity.currentOrderId = BigInt.zero()
    marketAccountEntity.collateral = BigInt.zero()

    marketAccountEntity.maker = BigInt.zero()
    marketAccountEntity.long = BigInt.zero()
    marketAccountEntity.short = BigInt.zero()

    marketAccountEntity.pendingMaker = BigInt.zero()
    marketAccountEntity.pendingLong = BigInt.zero()
    marketAccountEntity.pendingShort = BigInt.zero()
    marketAccountEntity.makerInvalidation = BigInt.zero()
    marketAccountEntity.longInvalidation = BigInt.zero()
    marketAccountEntity.shortInvalidation = BigInt.zero()

    marketAccountEntity.save()
  }

  return marketAccountEntity
}
