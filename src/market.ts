import { Bytes, Address, BigInt, dataSource } from '@graphprotocol/graph-ts'

import {
  Updated as UpdatedEvent,
  OrderCreated as OrderCreated_v2_0Event,
  OrderCreated1 as OrderCreated_v2_1Event,
  OrderCreated2 as OrderCreated_v2_2Event,
  OracleUpdated as OracleUpdatedEvent,
  AccountPositionProcessed1 as AccountPositionProcessed_v2_0Event,
  AccountPositionProcessed as AccountPositionProcessed_v2_1Event,
  AccountPositionProcessed2 as AccountPositionProcessed_v2_2Event,
  PositionProcessed as PositionProcessed_v2_0Event,
  PositionProcessed1 as PositionProcessed_v2_1Event,
  PositionProcessed2 as PositionProcessed_v2_2Event,
} from '../generated/templates/Market/Market'
import {
  Market as MarketStore,
  Oracle as OracleStore,
  OracleVersion as OracleVersionStore,
  Account as AccountStore,
  MarketAccount as MarketAccountStore,
  Position as PositionStore,
  Order as OrderStore,
  MarketOrder as MarketOrderStore,
  MarketAccumulator as MarketAccumulatorStore,
} from '../generated/schema'
import { Market_v2_0 as Market_v2_0Contract } from '../generated/templates/Market/Market_v2_0'
import { Payoff as PayoffContract } from '../generated/templates/Market/Payoff'

import { IdSeparatorBytes, ZeroAddress } from './util/constants'
import { bigIntToBytes, magnitude, side } from './util'
import { getOrCreateOracleVersion } from './subOracle'
import { createOracleAndSubOracle } from './market-factory'
import { activeForkForNetwork } from './util/forks'
import { accumulatorAccumulated, accumulatorIncrement } from './util/big6Math'

// Event Handler Entrypoints
export function handleUpdated(event: UpdatedEvent): void {
  // If block >= v2.0.2 fork block, return
  const fork = activeForkForNetwork(dataSource.network(), event.block.number)
  if (fork != 'v2_0_1') return

  const market = event.address
  const account = event.params.account
  const marketAccount = MarketAccountStore.load(buildMarketAccountEntityId(market, account))
  if (!marketAccount) throw new Error('HandleUpdated: Market Account not found')

  // Adjust position for invalidation
  const latestPosition = Market_v2_0Contract.bind(market).pendingPositions(account, marketAccount.latestOrderId)
  const currentPosition = Market_v2_0Contract.bind(market).pendingPositions(account, marketAccount.currentOrderId)
  const adjustedMaker = currentPosition.maker.plus(
    latestPosition.invalidation.maker.minus(currentPosition.invalidation.maker),
  )
  const adjustedLong = currentPosition.long.plus(
    latestPosition.invalidation.long.minus(currentPosition.invalidation.long),
  )
  const adjustedShort = currentPosition.short.plus(
    latestPosition.invalidation.short.minus(currentPosition.invalidation.short),
  )

  // Create new order for Update by comparing position size with previous position size
  handleOrderCreated(
    market,
    account,
    event.params.version,
    event.params.newMaker.minus(adjustedMaker),
    event.params.newLong.minus(adjustedLong),
    event.params.newShort.minus(adjustedShort),
    event.params.collateral,
    event.transaction.hash,
  )
}

export function handleOrderCreated_v2_0_2(event: OrderCreated_v2_0Event): void {
  handleOrderCreated(
    event.address,
    event.params.account,
    event.params.version,
    event.params.order.maker,
    event.params.order.long,
    event.params.order.short,
    event.params.collateral,
    event.transaction.hash,
  )
}

export function handleOrderCreated_v2_1(event: OrderCreated_v2_1Event): void {
  handleOrderCreated(
    event.address,
    event.params.account,
    event.params.version,
    event.params.order.maker,
    event.params.order.long,
    event.params.order.short,
    event.params.collateral,
    event.transaction.hash,
  )
}

export function handleOrderCreated_v2_2(event: OrderCreated_v2_2Event): void {
  handleOrderCreated(
    event.address,
    event.params.account,
    event.params.order.timestamp,
    event.params.order.makerPos.minus(event.params.order.makerNeg),
    event.params.order.longPos.minus(event.params.order.longNeg),
    event.params.order.shortPos.minus(event.params.order.shortNeg),
    event.params.order.collateral,
    event.transaction.hash,
  )
}

export function handleAccountPositionProcessed_v2_0(event: AccountPositionProcessed_v2_0Event): void {
  const positionFees = event.params.accumulationResult.keeper.plus(event.params.accumulationResult.positionFee)

  // TODO: Get liquidation fee

  handleAccountPositionProcessed(
    event.address,
    event.params.account,
    event.params.toOracleVersion,
    event.params.accumulationResult.collateralAmount,
    positionFees,
    event.params.toPosition,
  )
}

export function handleAccountPositionProcessed_v2_1(event: AccountPositionProcessed_v2_1Event): void {
  const positionFees = event.params.accumulationResult.keeper.plus(event.params.accumulationResult.positionFee)

  // TODO: Get liquidation fee

  handleAccountPositionProcessed(
    event.address,
    event.params.account,
    event.params.toOracleVersion,
    event.params.accumulationResult.collateralAmount,
    positionFees,
    event.params.toPosition,
  )
}

export function handleAccountPositionProcessed_v2_2(event: AccountPositionProcessed_v2_2Event): void {
  const positionFees = event.params.accumulationResult.adiabaticFee
    .plus(event.params.accumulationResult.proportionalFee)
    .plus(event.params.accumulationResult.linearFee)
    .plus(event.params.accumulationResult.liquidationFee)
    .plus(event.params.accumulationResult.settlementFee)

  handleAccountPositionProcessed(
    event.address,
    event.params.account,
    event.params.order.timestamp,
    event.params.accumulationResult.collateral,
    positionFees,
    event.params.orderId,
  )
}

export function handlePositionProcessed_v2_0(event: PositionProcessed_v2_0Event): void {
  const market = MarketStore.load(event.address)
  if (!market) throw new Error('HandlePositionProcessed: Market not found')

  createMarketAccumulator(
    event.address,
    event.params.fromOracleVersion,
    event.params.toOracleVersion,
    market.maker,
    market.long,
    market.short,
    event.params.accumulationResult.pnlMaker,
    event.params.accumulationResult.pnlLong,
    event.params.accumulationResult.pnlShort,
    event.params.accumulationResult.fundingMaker,
    event.params.accumulationResult.fundingLong,
    event.params.accumulationResult.fundingShort,
    event.params.accumulationResult.interestMaker,
    event.params.accumulationResult.interestLong,
    event.params.accumulationResult.interestShort,
    event.params.accumulationResult.positionFeeMaker,
  )

  // Update position
  updateMarketGlobalPosition(market, event.params.toOracleVersion, event.params.toPosition)
}

export function handlePositionProcessed_v2_1(event: PositionProcessed_v2_1Event): void {
  const market = MarketStore.load(event.address)
  if (!market) throw new Error('HandlePositionProcessed: Market not found')

  createMarketAccumulator(
    event.address,
    event.params.fromOracleVersion,
    event.params.toOracleVersion,
    market.maker,
    market.long,
    market.short,
    event.params.accumulationResult.pnlMaker,
    event.params.accumulationResult.pnlLong,
    event.params.accumulationResult.pnlShort,
    event.params.accumulationResult.fundingMaker,
    event.params.accumulationResult.fundingLong,
    event.params.accumulationResult.fundingShort,
    event.params.accumulationResult.interestMaker,
    event.params.accumulationResult.interestLong,
    event.params.accumulationResult.interestShort,
    event.params.accumulationResult.positionFeeMaker,
  )

  // Update position
  updateMarketGlobalPosition(market, event.params.toOracleVersion, event.params.toPosition)
}

export function handlePositionProcessed_v2_2(event: PositionProcessed_v2_2Event): void {
  const market = MarketStore.load(event.address)
  if (!market) throw new Error('HandlePositionProcessed: Market not found')

  createMarketAccumulator(
    event.address,
    market.latestVersion,
    event.params.order.timestamp,
    market.maker,
    market.long,
    market.short,
    event.params.accumulationResult.pnlMaker,
    event.params.accumulationResult.pnlLong,
    event.params.accumulationResult.pnlShort,
    event.params.accumulationResult.fundingMaker,
    event.params.accumulationResult.fundingLong,
    event.params.accumulationResult.fundingShort,
    event.params.accumulationResult.interestMaker,
    event.params.accumulationResult.interestLong,
    event.params.accumulationResult.interestShort,
    event.params.accumulationResult.positionFeeMaker,
  )

  // Update position
  updateMarketGlobalPosition(market, event.params.order.timestamp, event.params.orderId)
}

// As part of the v2.2 migration, new oracles were set for the power perp markets
// We will need to create new templates for the Oracle and SubOracle for this
export function handleOracleUpdated(event: OracleUpdatedEvent): void {
  createOracleAndSubOracle(event.params.newOracle)

  const market = MarketStore.load(event.address)
  if (!market) throw new Error('HandleOracleUpdated: Market not found')

  market.oracle = event.params.newOracle
  market.save()
}

// Business Logic
function handleOrderCreated(
  market: Address,
  account: Address,
  version: BigInt,
  maker: BigInt,
  long: BigInt,
  short: BigInt,
  collateral: BigInt,
  transactionHash: Bytes,
): void {
  // Load Related Entities
  const marketEntity = MarketStore.load(market)
  if (!marketEntity) throw new Error('HandleOrderCreated: Market not found')

  const oracle = OracleStore.load(marketEntity.oracle)
  if (!oracle) throw new Error('HandleOrderCreated: Oracle not found')

  const marketAccount = MarketAccountStore.load(buildMarketAccountEntityId(market, account))
  if (!marketAccount) throw new Error('HandleOrderCreated: Market Account not found')

  // Create position if it does not exist
  let position = createMarketAccountPosition(marketAccount)

  // Increment the currentOrderId if new version
  if (version.gt(marketAccount.currentVersion)) {
    marketAccount.currentOrderId = marketAccount.currentOrderId.plus(BigInt.fromU32(1))
  }
  marketAccount.currentVersion = version
  if (version.gt(marketEntity.currentVersion)) {
    marketEntity.currentOrderId = marketEntity.currentOrderId.plus(BigInt.fromU32(1))
  }
  marketEntity.currentVersion = version

  // If this is taking the position from zero to non-zero, increment the positionNonce and created
  // a new position entity
  const delta = maker.isZero() ? (long.isZero() ? short : long) : maker
  const positionMagnitude = magnitude(position.maker, position.long, position.short)
  if (!delta.isZero() && positionMagnitude.isZero()) {
    marketAccount.positionNonce = marketAccount.positionNonce.plus(BigInt.fromU32(1))

    // Snapshot the current collateral as the start collateral for the position
    position = createMarketAccountPosition(marketAccount)
    position.startCollateral = marketAccount.collateral
  }

  // Create and update Order
  const order = createMarketAccountPositionOrder(
    market,
    account,
    position.id,
    oracle.subOracle,
    marketAccount.currentOrderId,
    version,
    marketAccount.collateral,
  )
  order.maker = order.maker.plus(maker)
  order.long = order.long.plus(long)
  order.short = order.short.plus(short)
  order.collateral = order.collateral.plus(collateral)
  order.executionPrice = marketEntity.latestPrice

  // Add Transaction Hash if not already present
  const txHashes = order.transactionHashes
  if (!txHashes.includes(transactionHash)) {
    txHashes.push(transactionHash)
    order.transactionHashes = txHashes
  }

  // If the order is not associated with the current position, update the position. This can happen
  // if there are some fees charged on the position before the position is changed
  if (order.position.notEqual(position.id)) {
    order.position = position.id
  }

  // Update Position Collateral
  marketAccount.collateral = marketAccount.collateral.plus(collateral)

  const marketOrder = createMarketOrder(market, oracle.subOracle, marketEntity.currentOrderId, version)
  marketOrder.maker = marketOrder.maker.plus(maker)
  marketOrder.long = marketOrder.long.plus(long)
  marketOrder.short = marketOrder.short.plus(short)

  // Save Entities
  order.save()
  position.save()
  marketAccount.save()
  marketEntity.save()
  marketOrder.save()
}

function handleAccountPositionProcessed(
  market: Address,
  account: Address,
  toVersion: BigInt,
  collateral: BigInt,
  positionFees: BigInt,
  orderId: BigInt,
): void {
  const marketAccountEntity = createMarketAccount(market, account)
  marketAccountEntity.latestOrderId = orderId
  // The first order processed will have an orderId of 1
  if (marketAccountEntity.latestOrderId.isZero()) {
    marketAccountEntity.latestVersion = toVersion
    marketAccountEntity.save()
    return
  }

  const latestOrder = OrderStore.load(buildOrderEntityId(market, account, marketAccountEntity.latestOrderId))
  if (!latestOrder) throw new Error('HandleAccountPositionProcessed: Latest Order not found')

  const position = PositionStore.load(latestOrder.position)
  if (!position) throw new Error('HandleAccountPositionProcessed: Position not found')

  /* const fromMarketAccumulator = MarketAccumulatorStore.load(
    buildMarketAccumulatorId(market, marketAccountEntity.latestVersion),
  )
  const toMarketAccumulator = MarketAccumulatorStore.load(buildMarketAccumulatorId(market, toVersion))
  if (!fromMarketAccumulator || !toMarketAccumulator)
    throw new Error(
      `HandleAccountPositionProcessed: Accumulator not found ${market}: ${marketAccountEntity.latestVersion}-${toVersion}`,
    ) */

  // Update Order Values
  latestOrder.accumulation_collateral = latestOrder.accumulation_collateral.plus(collateral)
  latestOrder.accumulation_fees = latestOrder.accumulation_fees.plus(positionFees)
  /* const magnitude_ = magnitude(position.maker, position.long, position.short)
  const side_ = side(position.maker, position.long, position.short)
  latestOrder.subAccumulation_pnl = latestOrder.subAccumulation_pnl.plus(
    accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'pnl'),
  )
  latestOrder.subAccumulation_funding = latestOrder.subAccumulation_funding.plus(
    accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'funding'),
  )
  latestOrder.subAccumulation_interest = latestOrder.subAccumulation_interest.plus(
    accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'interest'),
  )
  latestOrder.subAccumulation_makerPositionFee = latestOrder.subAccumulation_makerPositionFee.plus(
    accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'positionFee'),
  ) */
  // TODO: Split up fees into market/keeper/liquidation/additive(?)
  // TODO: Add priceImpact (aka offset) to the order - calculation of these will be version dependent
  // TODO: Save subtractive fees

  // Update Market Account collateral and latestVersion after process
  marketAccountEntity.collateral = marketAccountEntity.collateral.plus(collateral).minus(positionFees)
  marketAccountEntity.latestVersion = toVersion

  // Save Entities
  latestOrder.save()
  marketAccountEntity.save()
}

function updateMarketGlobalPosition(market: MarketStore, toOracleVersion: BigInt, toPosition: BigInt): void {
  // The first order processed will have an orderId of 1, skip if there is a sync (positions are equal)
  if (market.latestOrderId.isZero() || market.latestOrderId.equals(toPosition)) {
    market.latestVersion = toOracleVersion
    market.latestOrderId = toPosition
    market.save()
    return
  }

  const order = MarketOrderStore.load(buildMarketOrderEntityId(market.id, toPosition))
  if (!order) throw new Error('HandlePositionProcessed: Order not found')

  const oracleVersion = OracleVersionStore.load(order.oracleVersion)
  if (!oracleVersion) throw new Error('HandlePositionProcessed: Oracle Version not found')

  // If valid, update the market values
  if (oracleVersion.valid) {
    market.maker = market.maker.plus(order.maker)
    market.long = market.long.plus(order.long)
    market.short = market.short.plus(order.short)
  }

  market.latestVersion = toOracleVersion
  market.latestOrderId = toPosition
  market.save()
}

// Callback to Process Order Fulfillment
export function fulfillOrder(order: OrderStore, price: BigInt): void {
  const position = PositionStore.load(order.position)
  if (!position) throw new Error('FulfillOrder: Position not found')

  // TODO: We could probably pull the market address directly from the position ID
  const marketAccount = MarketAccountStore.load(position.account)
  if (!marketAccount) throw new Error('FulfillOrder: Market Account not found')

  const market = MarketStore.load(marketAccount.market)
  if (!market) throw new Error('FulfillOrder: Market not found')

  // If order is fulfilled, update the position
  position.maker = position.maker.plus(order.maker)
  position.long = position.long.plus(order.long)
  position.short = position.short.plus(order.short)

  let transformedPrice = price
  const marketPayoff = market.payoff
  if (marketPayoff) {
    if (marketPayoff.notEqual(ZeroAddress)) {
      const payoffContract = PayoffContract.bind(Address.fromBytes(marketPayoff))
      transformedPrice = payoffContract.payoff(price)
    }
  }

  order.executionPrice = transformedPrice
  market.latestPrice = transformedPrice

  // Save Entities
  order.save()
  position.save()
  market.save()
}

// Entity Creation
function buildMarketAccountEntityId(market: Address, account: Address): Bytes {
  return market.concat(IdSeparatorBytes).concat(account)
}
function createMarketAccount(market: Address, account: Address): MarketAccountStore {
  let accountEntity = AccountStore.load(account)
  if (!accountEntity) {
    accountEntity = new AccountStore(account)
    accountEntity.save()
  }

  const marketAccountEntityId = buildMarketAccountEntityId(market, account)
  let marketAccountEntity = MarketAccountStore.load(marketAccountEntityId)
  if (!marketAccountEntity) {
    marketAccountEntity = new MarketAccountStore(marketAccountEntityId)
    marketAccountEntity.account = account
    marketAccountEntity.market = market
    marketAccountEntity.positionNonce = BigInt.zero()
    marketAccountEntity.latestVersion = BigInt.zero()
    marketAccountEntity.currentVersion = BigInt.zero()
    marketAccountEntity.latestOrderId = BigInt.zero()
    marketAccountEntity.currentOrderId = BigInt.zero()
    marketAccountEntity.collateral = BigInt.zero()
    marketAccountEntity.save()
  }

  return marketAccountEntity
}

function buildPositionEntityId(marketAccount: MarketAccountStore): Bytes {
  return marketAccount.id.concat(IdSeparatorBytes).concat(bigIntToBytes(marketAccount.positionNonce))
}
function createMarketAccountPosition(marketAccountEntity: MarketAccountStore): PositionStore {
  const positionId = buildPositionEntityId(marketAccountEntity)
  let positionEntity = PositionStore.load(positionId)
  if (!positionEntity) {
    // Create Position
    positionEntity = new PositionStore(positionId)
    positionEntity.account = marketAccountEntity.id
    positionEntity.nonce = marketAccountEntity.positionNonce
    positionEntity.maker = BigInt.zero()
    positionEntity.long = BigInt.zero()
    positionEntity.short = BigInt.zero()
    positionEntity.startCollateral = BigInt.zero()
    positionEntity.save()
  }

  return positionEntity
}

function buildOrderEntityId(market: Bytes, account: Bytes, orderId: BigInt): Bytes {
  return market.concat(IdSeparatorBytes).concat(account).concat(IdSeparatorBytes).concat(bigIntToBytes(orderId))
}
function createMarketAccountPositionOrder(
  market: Bytes,
  account: Bytes,
  marketAccountPositionId: Bytes,
  subOracleAddress: Bytes,
  orderId: BigInt,
  oracleVersion: BigInt,
  newEntity_startCollateral: BigInt,
): OrderStore {
  const entityId = buildOrderEntityId(market, account, orderId)

  let orderEntity = OrderStore.load(entityId)
  if (!orderEntity) {
    // Create Order
    orderEntity = new OrderStore(entityId)
    orderEntity.position = marketAccountPositionId
    orderEntity.orderId = orderId
    orderEntity.version = oracleVersion
    orderEntity.maker = BigInt.zero()
    orderEntity.long = BigInt.zero()
    orderEntity.short = BigInt.zero()
    orderEntity.collateral = BigInt.zero()
    orderEntity.startCollateral = newEntity_startCollateral
    orderEntity.transactionHashes = []

    orderEntity.accumulation_collateral = BigInt.zero()
    orderEntity.accumulation_fees = BigInt.zero()

    // If we are creating an oracle version here, it is unrequested because the request comes before the OrderCreated event
    const oracleVersionEntity = getOrCreateOracleVersion(subOracleAddress, oracleVersion, false)
    orderEntity.oracleVersion = oracleVersionEntity.id
    orderEntity.executionPrice = BigInt.zero()

    orderEntity.subAccumulation_pnl = BigInt.zero()
    orderEntity.subAccumulation_funding = BigInt.zero()
    orderEntity.subAccumulation_interest = BigInt.zero()
    orderEntity.subAccumulation_makerPositionFee = BigInt.zero()

    orderEntity.save()
  }

  return orderEntity
}

function buildMarketOrderEntityId(market: Bytes, orderId: BigInt): Bytes {
  return market.concat(IdSeparatorBytes).concat(bigIntToBytes(orderId))
}
function createMarketOrder(
  market: Bytes,
  subOracleAddress: Bytes,
  orderId: BigInt,
  oracleVersion: BigInt,
): MarketOrderStore {
  const entityId = buildMarketOrderEntityId(market, orderId)

  let marketOrderEntity = MarketOrderStore.load(entityId)
  if (!marketOrderEntity) {
    // Create Order
    marketOrderEntity = new MarketOrderStore(entityId)
    marketOrderEntity.version = oracleVersion
    marketOrderEntity.maker = BigInt.zero()
    marketOrderEntity.long = BigInt.zero()
    marketOrderEntity.short = BigInt.zero()

    const oracleVersionEntity = getOrCreateOracleVersion(subOracleAddress, oracleVersion, false)
    marketOrderEntity.oracleVersion = oracleVersionEntity.id

    marketOrderEntity.save()
  }

  return marketOrderEntity
}

function buildMarketAccumulatorId(market: Address, version: BigInt): Bytes {
  return market.concat(IdSeparatorBytes).concat(bigIntToBytes(version))
}
function createMarketAccumulator(
  market: Address,
  fromVersion: BigInt,
  toVersion: BigInt,
  maker: BigInt,
  long: BigInt,
  short: BigInt,
  pnlMaker: BigInt,
  pnlLong: BigInt,
  pnlShort: BigInt,
  fundingMaker: BigInt,
  fundingLong: BigInt,
  fundingShort: BigInt,
  interestMaker: BigInt,
  interestLong: BigInt,
  interestShort: BigInt,
  positionFeeMaker: BigInt,
): void {
  /* const fromId = buildMarketAccumulatorId(market, fromVersion)
  const toId = buildMarketAccumulatorId(market, toVersion)
  const fromAccumulator = MarketAccumulatorStore.load(fromId)
  let entity = new MarketAccumulatorStore(toId)

  entity.market = market
  entity.version = toVersion

  // Accumulate the values
  entity.pnlMaker = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.pnlMaker,
    pnlMaker,
    maker,
  )
  entity.pnlLong = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.pnlLong,
    pnlLong,
    long,
  )
  entity.pnlShort = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.pnlShort,
    pnlShort,
    short,
  )
  entity.fundingMaker = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.fundingMaker,
    fundingMaker,
    maker,
  )
  entity.fundingLong = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.fundingLong,
    fundingLong,
    long,
  )
  entity.fundingShort = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.fundingShort,
    fundingShort,
    short,
  )
  entity.interestMaker = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.interestMaker,
    interestMaker,
    maker,
  )
  entity.interestLong = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.interestLong,
    interestLong,
    long,
  )
  entity.interestShort = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.interestShort,
    interestShort,
    short,
  )
  entity.positionFeeMaker = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.positionFeeMaker,
    positionFeeMaker,
    maker,
  )

  entity.save() */
}
