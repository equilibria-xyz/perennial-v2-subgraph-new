import {
  Updated as UpdatedEvent,
  OrderCreated as OrderCreated_v2_0Event,
  OrderCreated1 as OrderCreated_v2_1Event,
  OrderCreated2 as OrderCreated_v2_2Event,
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
import { bigIntToBytes } from './util'
import { getorCreateOracleVersion } from './subOracle'

// Event Handler Entrypoints
export function handleUpdated(event: UpdatedEvent): void {
  return
}

export function handleOrderCreated_v2_0_1(event: OrderCreated_v2_0Event): void {
  handleOrderCreated(event.address, event.params.account, event.params.version)
}

export function handleOrderCreated_v2_1(event: OrderCreated_v2_1Event): void {
  handleOrderCreated(event.address, event.params.account, event.params.version)
}

export function handleOrderCreated_v2_2(event: OrderCreated_v2_2Event): void {
  handleOrderCreated(event.address, event.params.account, event.params.order.timestamp)
}

// Business Logic
function handleOrderCreated(market: Address, account: Address, version: BigInt): void {
  const marketEntity = MarketStore.load(market)
  if (!marketEntity) throw new Error('HandleOrderCreated: Market not found')

  const marketAccount = getorCreateMarketAccount(market, account)
  const position = getOrCreateMarketAccountPosition(marketAccount)

  const oracle = OracleStore.load(marketEntity.oracle)
  if (!oracle) throw new Error('HandleOrderCreated: Oracle not found')

  // TODO: If this is taking the position from zero to non-zero, increment the positionNonce

  const order = getOrCreateMarketAccountPositionOrder(position, oracle.subOracle, version)
}

export function fulfillOrder(order: OrderStore, price: BigInt): void {
  // TODO: transform price with payoff
  order.executionPrice = price

  order.save()
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
    positionEntity.save()
  }

  return positionEntity
}

function getOrCreateMarketAccountPositionOrder(
  marketAccountPosition: PositionStore,
  subOracleAddress: Bytes,
  oracleVersion: BigInt,
): OrderStore {
  const orderId = marketAccountPosition.id.concat(IdSeparatorBytes).concat(bigIntToBytes(oracleVersion))

  let orderEntity = OrderStore.load(orderId)
  if (!orderEntity) {
    // Create Position
    orderEntity = new OrderStore(orderId)
    orderEntity.position = marketAccountPosition.id

    // If we are creating an oracle version here, it is unrequested because the request comes before the OrderCreated event
    const oracleVersionEntity = getorCreateOracleVersion(subOracleAddress, oracleVersion, false)
    orderEntity.oracleVersion = oracleVersionEntity.id
    orderEntity.executionPrice = oracleVersionEntity.requested ? BigInt.zero() : BigInt.fromI32(-1) // TODO: Get latest market price if unrequested

    orderEntity.save()
  }

  return orderEntity
}
