import { Address, BigInt, Bytes, crypto } from '@graphprotocol/graph-ts'
import {
  OrderPlaced as OrderPlacedEvent,
  OrderPlaced1 as OrderPlaced1Event,
  OrderExecuted as OrderExecutedEvent,
  OrderExecuted1 as OrderExecuted1Event,
  OrderCancelled as OrderCancelledEvent,
} from '../generated/MultiInvoker/MultiInvoker'
import {
  MarketAccount as MarketAccountStore,
  Order as OrderStore,
  MultiInvokerTriggerOrder as MultiInvokerTriggerOrderStore,
} from '../generated/schema'
import { bigIntToBytes } from './util'
import { ZeroAddress } from './util/constants'
import { buildMarketAccountEntityId, buildOrderId } from './market'

export function handleTriggerOrderCancelled(event: OrderCancelledEvent): void {
  const triggerOrder = MultiInvokerTriggerOrderStore.load(bigIntToBytes(event.params.nonce))
  if (!triggerOrder) return

  triggerOrder.cancelled = true
  triggerOrder.save()
}

export function handleTriggerOrderExecuted(event: OrderExecutedEvent): void {
  const triggerOrder = MultiInvokerTriggerOrderStore.load(bigIntToBytes(event.params.nonce))
  if (!triggerOrder) return

  triggerOrder.executed = true
  triggerOrder.save()
}

export function handleTriggerOrderExecuted1(event: OrderExecuted1Event): void {
  const triggerOrder = MultiInvokerTriggerOrderStore.load(bigIntToBytes(event.params.nonce))
  if (!triggerOrder) return

  triggerOrder.executed = true
  triggerOrder.save()
}

export function handleTriggerOrderPlaced(event: OrderPlacedEvent): void {
  const entity = new MultiInvokerTriggerOrderStore(bigIntToBytes(event.params.nonce))
  entity.account = event.params.account
  entity.market = event.params.market
  entity.nonce = event.params.nonce
  entity.triggerOrderSide = event.params.order.side
  entity.triggerOrderComparison = event.params.order.comparison
  entity.triggerOrderFee = event.params.order.fee
  entity.triggerOrderPrice = event.params.order.price
  entity.triggerOrderDelta = event.params.order.delta
  entity.triggerOrderInterfaceFee_amount = BigInt.zero()
  entity.triggerOrderInterfaceFee_receiver = ZeroAddress
  entity.triggerOrderInterfaceFee_unwrap = false
  entity.triggerOrderInterfaceFee2_amount = BigInt.zero()
  entity.triggerOrderInterfaceFee2_receiver = ZeroAddress
  entity.triggerOrderInterfaceFee2_unwrap = false

  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.executed = false
  entity.cancelled = false

  const associatedOrder = findAssociatedOrder(entity.market, entity.account, entity.transactionHash)
  if (associatedOrder) entity.associatedOrder = associatedOrder.id

  entity.save()
}

export function handleTriggerOrderPlaced1(event: OrderPlaced1Event): void {
  const entity = new MultiInvokerTriggerOrderStore(bigIntToBytes(event.params.nonce))
  entity.account = event.params.account
  entity.market = event.params.market
  entity.nonce = event.params.nonce
  entity.triggerOrderSide = event.params.order.side
  entity.triggerOrderComparison = event.params.order.comparison
  entity.triggerOrderFee = event.params.order.fee
  entity.triggerOrderPrice = event.params.order.price
  entity.triggerOrderDelta = event.params.order.delta
  entity.triggerOrderInterfaceFee_amount = event.params.order.interfaceFee1.amount
  entity.triggerOrderInterfaceFee_receiver = event.params.order.interfaceFee1.receiver
  entity.triggerOrderInterfaceFee_unwrap = event.params.order.interfaceFee1.unwrap
  entity.triggerOrderInterfaceFee2_amount = event.params.order.interfaceFee2.amount
  entity.triggerOrderInterfaceFee2_receiver = event.params.order.interfaceFee2.receiver
  entity.triggerOrderInterfaceFee2_unwrap = event.params.order.interfaceFee2.unwrap

  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.executed = false
  entity.cancelled = false

  const associatedOrder = findAssociatedOrder(entity.market, entity.account, entity.transactionHash)
  if (associatedOrder) entity.associatedOrder = associatedOrder.id

  entity.save()
}

function findAssociatedOrder(market: Bytes, account: Bytes, transactionHash: Bytes): OrderStore | null {
  const relatedMarketAccount = MarketAccountStore.load(
    buildMarketAccountEntityId(Address.fromBytes(market), Address.fromBytes(account)),
  )
  if (relatedMarketAccount) {
    const currentOrder = OrderStore.load(buildOrderId(market, account, relatedMarketAccount.currentOrderId))
    if (currentOrder && currentOrder.transactionHashes.includes(transactionHash)) {
      return currentOrder
    }
  }

  return null
}
