import { gql, request } from 'graphql-request'

const GRAPHQL_QUERY_PAGE_SIZE = 1000

// Perform a paginated query, assuming the caller includes `first` and `skip` variables
export async function query(query: string): Promise<{}> {
  // TODO: load from environment
  const graphURL = 'http://localhost:8000/subgraphs/name/equilibria-xyz/perennial-arbitrumSepolia-new'

  // make the first request
  let page = 0
  let result: Array<any> = await request(graphURL, query, {
    first: GRAPHQL_QUERY_PAGE_SIZE,
    skip: page * GRAPHQL_QUERY_PAGE_SIZE,
  })
  let collectedData = Object.values(result)[0]

  // request additional pages as necessary
  while (Object.values(result)[0].length === GRAPHQL_QUERY_PAGE_SIZE) {
    page += 1
    result = await request(graphURL, query, {
      first: GRAPHQL_QUERY_PAGE_SIZE,
      skip: page * GRAPHQL_QUERY_PAGE_SIZE,
    })
    collectedData = [...collectedData, ...Object.values(result)[0]]
  }

  return collectedData
}