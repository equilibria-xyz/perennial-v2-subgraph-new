const { config } = require('dotenv')
config()

const { writeFileSync } = require('fs')
const { request } = require('graphql-request')

const live = process.env.DIFF_TEST_LIVE_VERSION_URL
const test = process.env.DIFF_TEST_TEST_VERSION_URL

const entitiesToTest = [
  {
    collection: 'orderAccumulations',
    fields: [
      'id',
      'collateral_accumulation',
      'fee_accumulation',
      'collateral_subAccumulation_offset',
      'collateral_subAccumulation_pnl',
      'collateral_subAccumulation_funding',
      'collateral_subAccumulation_interest',
      'collateral_subAccumulation_makerPositionFee',
      'collateral_subAccumulation_makerExposure',
      'collateral_subAccumulation_priceOverride',
      'fee_subAccumulation_settlement',
      'fee_subAccumulation_trade',
      'fee_subAccumulation_liquidation',
      'fee_subAccumulation_additive',
      'fee_subAccumulation_triggerOrder',
      'metadata_subtractiveFee',
      'metadata_solverFee',
      'metadata_net',
    ],
    sort: 'id',
    where: '',
  },
]

async function collectData({ collection, fields, sort, where }, page = 0) {
  const query = `
    query ${collection}_Diff {
      ${collection}(${where ? `where:{${where}},` : ''}, first: 1000, skip: ${
        page * 1000
      }, orderBy: ${sort}, orderDirection: desc) {
        ${fields.join(',')}
      }
    }
  `

  const liveRes = await request(live, query)
  const testRes = await request(test, query)

  return {
    collection,
    liveRes,
    testRes,
  }
}

async function runDiff(write = false) {
  for (const entity of entitiesToTest) {
    let page = 0
    let hasMore = true
    while (hasMore) {
      const res = await collectData(entity, page)

      const str = JSON.stringify(res.liveRes, null, 2)
      const str2 = JSON.stringify(res.testRes, null, 2)

      const isEqual = str === str2
      console.log(`${entity.collection}: page: ${page} Checking Equality`, isEqual)
      if (write && !isEqual) {
        writeFileSync(`./test/data/${entity.collection}_${page}_live.json`, str)
        writeFileSync(`./test/data/${entity.collection}_${page}_test.json`, str2)
      }

      hasMore = res.liveRes[entity.collection].length === 1000
      page++
    }
  }
}

runDiff(process.env.DIFF_TEST_WRITE_DATA === 'true').then(() => console.log('Done'))
