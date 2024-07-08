import { expect } from 'chai';
import { describe, it } from 'mocha';
import { gql } from 'graphql-request';
import { query } from './helpers';

describe("Markets", () => {
  let result

  before(async () => {
    result = await query(gql`
      query markets($first: Int!, $skip: Int!){
        markets(first: $first, skip: $skip) {
          id
        }
      }
    `)
    console.log(result)
  } )

  it('has at least one market', async () => {
    expect(result.length).gt(0)
  })

  it('has no duplicate markets', async () => {
    const alreadyFound = new Set()
    for (var market of result) {
      expect(alreadyFound.has(market.id)).to.be.false
      alreadyFound.add(market.id)
    }
  })
})