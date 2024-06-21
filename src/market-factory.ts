import { Address, Bytes } from '@graphprotocol/graph-ts'
import {
  MarketCreated as MarketCreatedEvent,
  MarketCreated1 as MarketCreated1Event,
} from '../generated/MarketFactory/MarketFactory'
import { Oracle } from '../generated/MarketFactory/Oracle'
import { Market as MarketStore, Oracle as OracleStore, SubOracle as SubOracleStore } from '../generated/schema'
import { Market, SubOracle } from '../generated/templates'

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
  let oracleEntity = OracleStore.load(oracle)
  if (!oracleEntity) {
    oracleEntity = new OracleStore(oracle)
    const oracleContract = Oracle.bind(Address.fromBytes(oracleEntity.id))
    const global = oracleContract.global()
    const subOracle = oracleContract.oracles(global.getCurrent())
    oracleEntity.subOracle = subOracle.getProvider()
    oracleEntity.save()
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

  market.oracle = oracleEntity.id
  market.token = token
  market.payoff = payoff
  market.save()
}
