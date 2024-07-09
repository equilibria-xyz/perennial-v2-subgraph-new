import { expect } from 'chai';
import { describe, it } from 'mocha';
import { gql } from 'graphql-request';
import { query } from './helpers';

describe("MarketAccounts", () => {
  let marketAccounts

  before(async () => {
    marketAccounts = await query(gql`
      query marketAccounts($first: Int!, $skip: Int!){
        marketAccounts(first: $first, skip: $skip) {
          market{id}
        account{id}
        }
      }
    `)
  } )

  it('has at least one market account', async () => {
    expect(marketAccounts.length).gt(0)
  })

  it('all accounts exist', async () => {
    let accounts = await query(gql`
      query accounts($first: Int!, $skip: Int!){
        accounts(first: $first, skip: $skip) {
          id
        }
      }
    `)
    accounts = Object.values(accounts).map(a => a.id)
    for (var marketAccount of marketAccounts) {
      expect(accounts).to.include(marketAccount.account.id)
    }
  })

  it('all markets exist', async () => {
    let markets = await query(gql`
      query accmarketsounts($first: Int!, $skip: Int!){
        markets(first: $first, skip: $skip) {
          id
        }
      }
    `)
    markets = Object.values(markets).map(a => a.id)
    for (var marketAccount of marketAccounts) {
      expect(markets).to.include(marketAccount.market.id)
    }
  })
})