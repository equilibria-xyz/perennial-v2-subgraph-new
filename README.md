# Perennial v2 Subgraph

## Overview

This subgraph indexes data for Perennial v2 Markets and Accounts. It provides Account positions, orders, and stats.

## Entities

##### To learn about individual fields and relationships, see the [schema](./schema.graphql).

### `Market`

A `Market` represents the global state of the market, including global position sizes and latest version and order IDs. Markets contain a list of `marketAccounts` which represents each individual account which has participated in the market. Markets also have `accumulators` and `accumulations`, more information on those is available below.

A Market's ID is it's on-chain contract address.

### `MarketOrder`

A `MarketOrder` is the net resulting order for a given `OracleVersion`. The oracle's granularity determines how long each
`version` is; all orders for that version are aggregated into a single `MarketOrder`. The `MarketOrder` contains the
net position deltas for all orders in that version. It also contains each underlying account order that is part of the market order within the `accountOrders` field.

A MarketOrder's ID is the `Market` ID and the global order ID.

### `Account`

An `Account` represents a unique address that interacts with any `Market`. An account holds a list of `marketAccounts` which represents it's position in each market.

An Account's ID is it's on-chain address.

### `MarketAccount`

A `MarketAccount` represents an account's position in a given `Market`. It contains values for the account's current position in the market, as well as a list of `Position`s

A MarketAccount's ID is the `Market` ID and the `Account` ID.

### `Position`

A `Position` represents an `Account`'s running position in a `Market`. A new `Position` is created for an account _each time_ it's size (maker/long/short) goes from 0 to non-0. The Position entity contains snapshot values at the start of the position, and `Accumulation` values for PNL, Fees, and net deposits over the lifetime of the position. A position is made up of a number of `Order`s. Note that in the case where a maker/long/short size change occurs and the correspond `OracleVersion` is not `valid`, that order's is not applied to the overall position.

A Position's ID is the `Market` ID, the `Account` ID, and the account's position ID (incremented each time a new position is created).

### `Order`

An Order represent's an `Account`'s interaction with a `Market` at a given `OracleVersion`. An order may contain position size changes (maker/long/short), and/or collateral changes. Note that an `Account` can only have one maker, long, or short position in a market at a time. All updates which occur in the same `OracleVersion` are aggregated into a single `Order` for the Account.

An Order contains an `accumulation` which holds the fees and PNL accrued for that order

A Order's ID is the `Market` ID, the `Account` ID, and the account's order ID.

### `OrderAccumulation`

An `OrderAccumulation` is a child entity of both a `Position` and `Order`. In the position case, it contains aggregated values across all orders for that position. An `OrderAccumulation` contains values for PNL, Fees, and a breakdown of both PNL and Fees into their component parts.

### `Accumulator`s

Accumulators represent a running total of PNL, Fees, and net deposits for a parent entity (`Market` or `Account`). Accumulators are updated each time a new oracle version is processed (via on-chain `PositionProcessed` or `AccountPositionProcessed` events). Accumulators are useful in taking the _delta_ between two accumulators at different timestmaps, which will return the value change per position between the two timestamps. For example, to calculate the long funding accumulated between `T1` and `T2` for position `P`, one can do `P * (accumulator[T2].fundingLong - accumulator[T1].fundingLong`).

An Accumulator's ID is the parent entity's ID and version.

### `{Market, Account, MarketAccount}Accumulation`

These accumulations are bucketed values which contain the sum (or last) of the values for the given bucket. Valid buckets are `hourly`, `daily`, `weekly`, or `all`. The `all` bucket is an all-time cumulative value.

An Accumulation's ID is the bucket, parent entity's ID, and bucket timestamp.
