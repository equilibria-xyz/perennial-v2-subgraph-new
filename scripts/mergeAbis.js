const { mergeAbis } = require('@ponder/utils')
const { readFileSync, writeFileSync, existsSync } = require('fs')

const SharedContracts = [
  'Market',
  'MarketFactory',
  'Oracle',
  'OracleFactory',
  'Payoff',
  'SubOracleFactory',
  'MultiInvoker',
  'Vault',
  'VaultFactory',
  'Manager',
]
const versionsDirs = ['v2_0', 'v2_1', 'v2_2', 'v2_3']

console.log('Merging ABIs...')

for (const contract of SharedContracts) {
  const abis = []
  for (const versionDir of versionsDirs) {
    if (!existsSync(`abis/${versionDir}/${contract}.json`)) continue
    const abi = readFileSync(`abis/${versionDir}/${contract}.json`)
    abis.push(JSON.parse(abi))
  }

  console.log('Merging', contract)
  const res = mergeAbis(abis)
  writeFileSync(`abis/combined/${contract}.json`, JSON.stringify(res, null, 2))
}

console.log('Done.')
