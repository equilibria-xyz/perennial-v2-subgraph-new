import { Address } from '@graphprotocol/graph-ts'
import { Oracle as OracleStore, SubOracle as SubOracleStore } from '../generated/schema'
import { SubOracle } from '../generated/templates'
import { OracleUpdated } from '../generated/templates/Oracle/Oracle'

// When an Oracle is updated, we need to update the subOracle field
export function handleOracleUpdated(event: OracleUpdated): void {
  const oracleEntity = OracleStore.load(event.address)
  if (oracleEntity == null) throw new Error('Oracle not found')

  oracleEntity.subOracle = event.params.newProvider
  oracleEntity.save()

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
