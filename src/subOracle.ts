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
  getOrCreateOracleVersion(event.address, event.params.version, true, event.transaction.hash)
}

export function handleOracleProviderVersionFulfilled(event: OracleProviderVersionFulfilledEvent): void {
  const oracleContract = Oracle.bind(event.address)
  const price = oracleContract.at(event.params.version).price

  // All Fulfillment is valid prior to v2.1
  fulfillOracleVersion(event.address, event.params.version, price, true, event.transaction.hash)
}

export function handleOracleProviderVersionFulfilled1(event: OracleProviderVersionFulfilled1Event): void {
  fulfillOracleVersion(
    event.address,
    event.params.version.timestamp,
    event.params.version.price,
    event.params.version.valid,
    event.transaction.hash,
  )
}

function fulfillOracleVersion(subOracle: Bytes, version: BigInt, price: BigInt, valid: boolean, txHash: Bytes): void {
  const oracleVersion = getOrCreateOracleVersion(subOracle, version, false, null)
  oracleVersion.valid = valid
  oracleVersion.price = price
  oracleVersion.fulfillTransactionHash = txHash
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
export function getOrCreateOracleVersion(
  eventAddress: Bytes,
  version: BigInt,
  newEntity_requested: boolean,
  newEntity_requestTransactionHash: Bytes | null,
): OracleVersionStore {
  const entityID = eventAddress.concat(IdSeparatorBytes).concat(bigIntToBytes(version))
  let entity = OracleVersionStore.load(entityID)
  if (!entity) {
    entity = new OracleVersionStore(entityID)
    entity.subOracle = eventAddress
    entity.requested = newEntity_requested
    entity.requestTransactionHash = newEntity_requestTransactionHash
    entity.timestamp = version
    entity.valid = false
    entity.price = BigInt.zero()
    entity.save()
  }

  // Update the requested status if necessary
  let updated = false
  if (newEntity_requested && !entity.requested) {
    updated = true
    entity.requested = true
  }

  if (newEntity_requestTransactionHash && !entity.requestTransactionHash) {
    updated = true
    entity.requestTransactionHash = newEntity_requestTransactionHash
  }

  if (updated) entity.save()

  return entity
}
