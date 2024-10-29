import { VaultCreated as VaultCreatedEvent } from '../generated/VaultFactory/VaultFactory'
import { Updated as VaultUpdatedEvent } from '../generated/templates/Vault/Vault'
import { VaultUpdated, Vault as VaultStore } from '../generated/schema'
import { Vault } from '../generated/templates'

export function handleVaultCreated(event: VaultCreatedEvent): void {
  const vault = new VaultStore(event.params.vault)
  vault.save()

  Vault.create(event.params.vault)
}

export function handleVaultUpdated(event: VaultUpdatedEvent): void {
  let entity = new VaultUpdated(event.transaction.hash.concatI32(event.logIndex.toI32()))
  entity.vault = event.address
  entity.sender = event.params.sender
  entity.account = event.params.account
  entity.version = event.params.version
  entity.depositAssets = event.params.depositAssets
  entity.redeemShares = event.params.redeemShares
  entity.claimAssets = event.params.claimAssets

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
