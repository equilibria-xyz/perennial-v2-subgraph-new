import { Bytes } from '@graphprotocol/graph-ts'
import {
  MarketAccountAccumulation,
  Market,
  MarketAccount,
  MarketAccumulator,
  MarketOrder,
  Oracle,
  OracleVersion,
  Order,
  Position,
  AccountAccumulator,
} from '../../generated/schema'

// Helper Functions to Load or Throw Entities

export function loadMarketAccountAccumulation(id: Bytes): MarketAccountAccumulation {
  const entity = MarketAccountAccumulation.load(id)
  if (entity == null) throw new Error(`MarketAccountAccumulation ${id.toHexString()}): not found`)
  return entity
}

export function loadPosition(id: Bytes): Position {
  const entity = Position.load(id)
  if (entity == null) throw new Error(`Position ${id.toHexString()}): not found`)
  return entity
}

export function loadOrder(id: Bytes): Order {
  const entity = Order.load(id)
  if (entity == null) throw new Error(`Order ${id.toHexString()}): not found`)
  return entity
}

export function loadMarketOrder(id: Bytes): MarketOrder {
  const entity = MarketOrder.load(id)
  if (entity == null) throw new Error(`MarketOrder ${id.toHexString()}): not found`)
  return entity
}

export function loadMarketAccount(id: Bytes): MarketAccount {
  const entity = MarketAccount.load(id)
  if (entity == null) throw new Error(`MarketAccount ${id.toHexString()}): not found`)
  return entity
}

export function loadMarket(id: Bytes): Market {
  const entity = Market.load(id)
  if (entity == null) throw new Error(`Market ${id.toHexString()}): not found`)
  return entity
}

export function loadOracle(id: Bytes): Oracle {
  const entity = Oracle.load(id)
  if (entity == null) throw new Error(`Oracle ${id.toHexString()}): not found`)
  return entity
}

export function loadOracleVersion(id: Bytes): OracleVersion {
  const entity = OracleVersion.load(id)
  if (entity == null) throw new Error(`OracleVersion ${id.toHexString()}): not found`)
  return entity
}

export function loadMarketAccumulator(id: Bytes): MarketAccumulator {
  const entity = MarketAccumulator.load(id)
  if (entity == null) throw new Error(`MarketAccumulator ${id.toHexString()}): not found`)
  return entity
}

export function loadAccountAccumulator(id: Bytes): AccountAccumulator {
  const entity = AccountAccumulator.load(id)
  if (entity == null) throw new Error(`AccountAccumulator ${id.toHexString()}): not found`)
  return entity
}