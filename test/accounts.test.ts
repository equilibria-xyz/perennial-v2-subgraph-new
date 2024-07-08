import { expect } from 'chai';
import { describe, it } from 'mocha';
import { gql } from 'graphql-request';
import { query } from './helpers';

describe("Accounts", () => {
  let result

  before(async () => {
    result = await query(gql`
      query accounts($first: Int!, $skip: Int!){
        accounts(first: $first, skip: $skip) {
          id
        }
      }
    `)
  } )

  it('has at least one account', async () => {
    expect(result.length).gt(0)
  })

  it('has no duplicate accounts', async () => {
    const alreadyFound = new Set()
    for (var account of result) {
      expect(alreadyFound.has(account.id)).to.be.false
      alreadyFound.add(account.id)
    }
  })
})