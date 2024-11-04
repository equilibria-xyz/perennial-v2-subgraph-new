import { BigInt } from '@graphprotocol/graph-ts'
import {
  TriggerOrderPlaced as TriggerOrderPlacedEvent,
  TriggerOrderExecuted as TriggerOrderExecutedEvent,
  TriggerOrderCancelled as TriggerOrderCancelledEvent,
} from '../generated/Manager/Manager'
import { MultiInvokerTriggerOrder as TriggerOrderStore } from '../generated/schema'
import { findAssociatedOrder } from './multi-invoker'
import { triggerOrderId } from './util'
import { buildMarketAccountEntityId } from './util/loadOrCreate'
import { ZeroAddress } from './util/constants'

export function handleTriggerOrderPlaced(event: TriggerOrderPlacedEvent): void {
  // Manager trigger orders can be updated
  const id = triggerOrderId(event.address, event.params.orderId)
  let entity = TriggerOrderStore.load(id)
  if (!entity) {
    entity = new TriggerOrderStore(id)
  }

  entity.marketAccount = buildMarketAccountEntityId(event.params.market, event.params.account)
  entity.source = event.address
  entity.account = event.params.account
  entity.market = event.params.market
  entity.nonce = event.params.orderId
  entity.triggerOrderSide = event.params.order.side
  entity.triggerOrderComparison = event.params.order.comparison
  entity.triggerOrderFee = event.params.order.maxFee
  entity.triggerOrderPrice = event.params.order.price
  entity.triggerOrderDelta = event.params.order.delta
  entity.triggerOrderInterfaceFee_amount = event.params.order.interfaceFee.amount
  entity.triggerOrderInterfaceFee_receiver = event.params.order.interfaceFee.receiver
  entity.triggerOrderInterfaceFee_unwrap = false
  entity.triggerOrderInterfaceFee_fixed = event.params.order.interfaceFee.fixedFee
  entity.triggerOrderInterfaceFee2_amount = BigInt.zero()
  entity.triggerOrderInterfaceFee2_receiver = ZeroAddress
  entity.triggerOrderInterfaceFee2_unwrap = false
  entity.triggerOrderInterfaceFee2_fixed = false
  entity.triggerOrderReferrer = event.params.order.referrer
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.executed = false
  entity.cancelled = false

  const associatedOrder = findAssociatedOrder(entity.market, entity.account, entity.transactionHash)
  if (associatedOrder) entity.associatedOrder = associatedOrder.id

  entity.save()
}

export function handleTriggerOrderExecuted(event: TriggerOrderExecutedEvent): void {
  const triggerOrder = TriggerOrderStore.load(triggerOrderId(event.address, event.params.orderId))
  if (!triggerOrder) return

  triggerOrder.executed = true
  triggerOrder.executionTransactionHash = event.transaction.hash
  triggerOrder.save()
}

export function handleTriggerOrderCancelled(event: TriggerOrderCancelledEvent): void {
  const triggerOrder = TriggerOrderStore.load(triggerOrderId(event.address, event.params.orderId))
  if (!triggerOrder) return

  triggerOrder.cancelled = true
  triggerOrder.cancellationTransactionHash = event.transaction.hash
  triggerOrder.save()
}
