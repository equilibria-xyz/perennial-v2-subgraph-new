import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts'
import {
  MarketCreated as MarketCreatedEvent,
  MarketCreated1 as MarketCreated1Event,
  OperatorUpdated,
} from '../generated/MarketFactory/MarketFactory'
import { Oracle as OracleContract } from '../generated/MarketFactory/Oracle'
import { Market as MarketStore, Oracle as OracleStore, SubOracle as SubOracleStore } from '../generated/schema'
import { Market, SubOracle, Oracle } from '../generated/templates'
import { loadOrCreateAccount } from './util/loadOrCreate'

export function handleMarketCreated(event: MarketCreatedEvent): void {
  createMarket(
    event.params.market,
    event.params.definition.token,
    event.params.definition.oracle,
    event.params.definition.payoff,
  )
}
export function handleMarketCreated1(event: MarketCreated1Event): void {
  createMarket(event.params.market, event.params.definition.token, event.params.definition.oracle, null)
}

function createMarket(address: Address, token: Bytes, oracle: Bytes, payoff: Bytes | null): void {
  // Create Market
  Market.create(address)
  const market = new MarketStore(address)

  // Create Oracle entity for market
  createOracleAndSubOracle(oracle)

  market.oracle = oracle
  market.token = token
  market.payoff = payoff
  market.maker = BigInt.zero()
  market.long = BigInt.zero()
  market.short = BigInt.zero()
  market.latestVersion = BigInt.zero()
  market.currentVersion = BigInt.zero()
  market.latestOrderId = BigInt.zero()
  market.currentOrderId = BigInt.zero()
  market.latestPrice = BigInt.zero()
  market.save()
}

export function createOracleAndSubOracle(oracle: Bytes): void {
  let oracleEntity = OracleStore.load(oracle)
  if (!oracleEntity) {
    oracleEntity = new OracleStore(oracle)
    const oracleContract = OracleContract.bind(Address.fromBytes(oracleEntity.id))
    const global = oracleContract.global()
    const subOracle = oracleContract.oracles(global.getCurrent())
    oracleEntity.subOracle = subOracle.getProvider()
    oracleEntity.save()

    // Create Template for Oracle
    Oracle.create(Address.fromBytes(oracleEntity.id))
  }

  // Create SubOracle entity for Oracle
  let subOracleEntity = SubOracleStore.load(oracleEntity.subOracle)
  if (!subOracleEntity) {
    subOracleEntity = new SubOracleStore(oracleEntity.subOracle)
    subOracleEntity.oracle = oracleEntity.id
    subOracleEntity.save()

    // Create Template for SubOracle
    SubOracle.create(Address.fromBytes(oracleEntity.subOracle))
  }
}

export function handleOperatorUpdated(event: OperatorUpdated): void {
  const account = loadOrCreateAccount(event.params.account)
  let newOperators = account.operators

  const enabled = event.params.newEnabled
  const operatorIndex = newOperators.indexOf(event.params.operator)

  if (operatorIndex >= 0 && !enabled) {
    newOperators.splice(operatorIndex, 1)
  } else if (operatorIndex < 0 && enabled) {
    newOperators.push(event.params.operator)
  }

  account.operators = newOperators
  account.save()
}
