import { BigInt, Bytes } from '@graphprotocol/graph-ts'
import { OracleVersion as OracleVersionStore } from '../generated/schema'
import {
  OracleProviderVersionRequested as OracleProviderVersionRequestedEvent,
  OracleProviderVersionFulfilled as OracleProviderVersionFulfilledEvent,
  OracleProviderVersionFulfilled1 as OracleProviderVersionFulfilled1Event,
  Oracle,
} from '../generated/templates/SubOracle/Oracle'
import { bigIntToBytes } from './util'
import { IdSeparatorBytes } from './util/constants'
import { fulfillOrder } from './market'

// Handler Entrypoints
export function handleOracleProviderVersionRequested(event: OracleProviderVersionRequestedEvent): void {
  getorCreateOracleVersion(event.address, event.params.version, true)
}

export function handleOracleProviderVersionFulfilled(event: OracleProviderVersionFulfilledEvent): void {
  const oracleContract = Oracle.bind(event.address)
  const price = oracleContract.at(event.params.version).price

  // All Fulfillment is valid prior to v2.1
  fulfillOracleVersion(event.address, event.params.version, price, true)
}

export function handleOracleProviderVersionFulfilled1(event: OracleProviderVersionFulfilled1Event): void {
  fulfillOracleVersion(
    event.address,
    event.params.version.timestamp,
    event.params.version.price,
    event.params.version.valid,
  )
}

function fulfillOracleVersion(subOracle: Bytes, version: BigInt, price: BigInt, valid: boolean): void {
  const oracleVersion = getorCreateOracleVersion(subOracle, version, false)
  oracleVersion.valid = valid
  oracleVersion.price = price
  oracleVersion.save()

  if (oracleVersion.valid) {
    const orders = oracleVersion.orders.load()
    for (let i = 0; i < orders.length; i++) {
      // Propagate the fulfillment to the Order
      fulfillOrder(orders[i], oracleVersion.price)
    }
  }
}

// Entity Creation
export function getorCreateOracleVersion(
  eventAddress: Bytes,
  version: BigInt,
  newEntity_requested: boolean,
): OracleVersionStore {
  const entityID = eventAddress.concat(IdSeparatorBytes).concat(bigIntToBytes(version))
  let entity = OracleVersionStore.load(entityID)
  if (!entity) {
    entity = new OracleVersionStore(entityID)
    entity.subOracle = eventAddress
    entity.requested = newEntity_requested
    entity.timestamp = version
    entity.valid = false
    entity.price = BigInt.zero()
    entity.save()
  }

  // Update the requested status if necessary
  if (newEntity_requested && !entity.requested) {
    entity.requested = true
    entity.save()
  }

  return entity
}
