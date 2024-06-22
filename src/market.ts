import {
  Updated as UpdatedEvent,
  OrderCreated as OrderCreated_v2_0Event,
  OrderCreated1 as OrderCreated_v2_1Event,
  OrderCreated2 as OrderCreated_v2_2Event,
  OracleUpdated as OracleUpdatedEvent,
} from '../generated/templates/Market/Market'
import {
  Market as MarketStore,
  Oracle as OracleStore,
  Account as AccountStore,
  MarketAccount as MarketAccountStore,
  Position as PositionStore,
  Order as OrderStore,
} from '../generated/schema'
import { Bytes, Address, BigInt } from '@graphprotocol/graph-ts'
import { IdSeparatorBytes } from './util/constants'
import { bigIntToBytes, magnitude } from './util'
import { getorCreateOracleVersion } from './subOracle'
import { createOracleAndSubOracle } from './market-factory'

// Event Handler Entrypoints
export function handleUpdated(event: UpdatedEvent): void {
  // TODO: Implement for v2.0.0 and v2.0.1 updates
  return
}

export function handleOrderCreated_v2_0_1(event: OrderCreated_v2_0Event): void {
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
  const marketEntity = MarketStore.load(market)
  if (!marketEntity) throw new Error('HandleOrderCreated: Market not found')

  const marketAccount = getorCreateMarketAccount(market, account)
  let position = getOrCreateMarketAccountPosition(marketAccount)

  const oracle = OracleStore.load(marketEntity.oracle)
  if (!oracle) throw new Error('HandleOrderCreated: Oracle not found')

  // Increment the currentOrderId if new version
  if (version.gt(marketAccount.currentVersion)) {
    marketAccount.currentOrderId = marketAccount.currentOrderId.plus(BigInt.fromU32(1))
  }
  marketAccount.currentVersion = version

  // If this is taking the position from zero to non-zero, increment the positionNonce and created
  // a new position entity
  const delta = maker.isZero() ? (long.isZero() ? short : long) : maker
  const positionMagnitude = magnitude(position.maker, position.long, position.short)
  if (!delta.isZero() && positionMagnitude.isZero()) {
    marketAccount.positionNonce = marketAccount.positionNonce.plus(BigInt.fromU32(1))

    // Snapshot the current collateral as the start collateral for the position
    position = getOrCreateMarketAccountPosition(marketAccount)
    position.startCollateral = marketAccount.collateral
  }

  // Create and update Order
  const order = getOrCreateMarketAccountPositionOrder(
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

  // Save Entities
  order.save()
  position.save()
  marketAccount.save()
}

export function fulfillOrder(order: OrderStore, price: BigInt): void {
  // TODO: transform price with payoff
  order.executionPrice = price

  const position = PositionStore.load(order.position)
  if (!position) throw new Error('FulfillOrder: Position not found')

  // If order is fulfilled, update the position
  position.maker = position.maker.plus(order.maker)
  position.long = position.long.plus(order.long)
  position.short = position.short.plus(order.short)

  // Save Entities
  order.save()
  position.save()
}

// Entity Creation
function getorCreateMarketAccount(market: Address, account: Address): MarketAccountStore {
  let accountEntity = AccountStore.load(account)
  if (!accountEntity) {
    accountEntity = new AccountStore(account)
    accountEntity.save()
  }

  const marketAccountEntityId = market.concat(IdSeparatorBytes).concat(account)
  let marketAccountEntity = MarketAccountStore.load(marketAccountEntityId)
  if (!marketAccountEntity) {
    marketAccountEntity = new MarketAccountStore(marketAccountEntityId)
    marketAccountEntity.account = account
    marketAccountEntity.market = market
    marketAccountEntity.positionNonce = BigInt.zero()
    marketAccountEntity.currentVersion = BigInt.zero()
    marketAccountEntity.currentOrderId = BigInt.zero()
    marketAccountEntity.collateral = BigInt.zero()
    marketAccountEntity.save()
  }

  return marketAccountEntity
}

function getOrCreateMarketAccountPosition(marketAccountEntity: MarketAccountStore): PositionStore {
  const positionId = marketAccountEntity.id
    .concat(IdSeparatorBytes)
    .concat(bigIntToBytes(marketAccountEntity.positionNonce))

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

function getOrCreateMarketAccountPositionOrder(
  market: Bytes,
  account: Bytes,
  marketAccountPositionId: Bytes,
  subOracleAddress: Bytes,
  orderId: BigInt,
  oracleVersion: BigInt,
  newEntity_startCollateral: BigInt,
): OrderStore {
  const entityId = market
    .concat(IdSeparatorBytes)
    .concat(account)
    .concat(IdSeparatorBytes)
    .concat(bigIntToBytes(orderId))

  let orderEntity = OrderStore.load(entityId)
  if (!orderEntity) {
    // Create Position
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

    // If we are creating an oracle version here, it is unrequested because the request comes before the OrderCreated event
    const oracleVersionEntity = getorCreateOracleVersion(subOracleAddress, oracleVersion, false)
    orderEntity.oracleVersion = oracleVersionEntity.id
    orderEntity.executionPrice = oracleVersionEntity.requested ? BigInt.zero() : BigInt.fromI32(-1) // TODO: Get latest market price if unrequested

    orderEntity.save()
  }

  return orderEntity
}
