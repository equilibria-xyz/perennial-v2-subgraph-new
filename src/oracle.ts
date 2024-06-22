import { Oracle } from '../generated/schema'
import { SubOracle } from '../generated/templates'
import { OracleUpdated } from '../generated/templates/Oracle/Oracle'

// When an Oracle is updated, we need to update the subOracle field
export function handleOracleUpdated(event: OracleUpdated): void {
  const entity = Oracle.load(event.address)
  if (entity == null) throw new Error('Oracle not found')

  entity.subOracle = event.params.newProvider
  entity.save()

  // Create a new datasource template for the new subOracle
  SubOracle.create(event.params.newProvider)
}
