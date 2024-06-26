import { Bytes, Address, BigInt, dataSource, ethereum } from '@graphprotocol/graph-ts'

import {
  Updated as UpdatedEvent,
  Updated1 as UpdatedReferrerEvent,
  OrderCreated as OrderCreated_v2_0Event,
  OrderCreated1 as OrderCreated_v2_1Event,
  OrderCreated2 as OrderCreated_v2_2Event,
  OracleUpdated as OracleUpdatedEvent,
  AccountPositionProcessed1 as AccountPositionProcessed_v2_0Event,
  AccountPositionProcessed as AccountPositionProcessed_v2_1Event,
  AccountPositionProcessed2 as AccountPositionProcessed_v2_2Event,
  PositionProcessed as PositionProcessed_v2_0Event,
  PositionProcessed1 as PositionProcessed_v2_1Event,
  PositionProcessed2 as PositionProcessed_v2_2Event,
} from '../generated/templates/Market/Market'
import {
  Account as AccountStore,
  MarketAccount as MarketAccountStore,
  Position as PositionStore,
  Order as OrderStore,
  MarketOrder as MarketOrderStore,
  MarketAccumulator as MarketAccumulatorStore,
  Accumulation as AccumulationStore,
} from '../generated/schema'
import { Market_v2_0 as Market_v2_0Contract } from '../generated/templates/Market/Market_v2_0'
import { Market_v2_1 as Market_v2_1Contract } from '../generated/templates/Market/Market_v2_1'
import { ParamReader_2_1_0 as ParamReader_2_1_0Contract } from '../generated/templates/Market/ParamReader_2_1_0'
import { Market_v2_2 as Market_v2_2Contract } from '../generated/templates/Market/Market_v2_2'
import { Payoff as PayoffContract } from '../generated/templates/Market/Payoff'
import { Oracle } from '../generated/templates/Oracle/Oracle'

import { IdSeparatorBytes, ZeroAddress } from './util/constants'
import { accountOrderSize, bigIntToBytes, notional, positionMagnitude, side } from './util'
import {
  loadAccumulation,
  loadMarket,
  loadMarketAccount,
  loadMarketAccumulator,
  loadMarketOrder,
  loadOracle,
  loadOracleVersion,
  loadOrder,
  loadPosition,
} from './util/loadOrThrow'
import { getOrCreateOracleVersion } from './subOracle'
import { createOracleAndSubOracle } from './market-factory'
import { activeForkForNetwork } from './util/forks'
import { accumulatorAccumulated, accumulatorIncrement, mul } from './util/big6Math'
import { processReceiptForFees } from './util/receiptFees'

// Event Handler Entrypoints
// Called for v2.0.0 to 2.1.0
export function handleUpdated(event: UpdatedEvent): void {
  const market = event.address
  const account = event.params.account

  // If block >= v2.0.2 fork block, return early
  const fork = activeForkForNetwork(dataSource.network(), event.block.number)
  if (fork != 'v2_0_1') {
    // Pre-v2.3, we need to use the Updated event for liquidation and referrer
    handleOrderCreated(
      market,
      account,
      event.params.version,
      BigInt.zero(), // Rely on OrderCreated for these values
      BigInt.zero(),
      BigInt.zero(),
      BigInt.zero(),
      event.transaction.hash,
      null,
      event.params.protect ? event.params.sender : null,
      event.params.protect,
      null, // Rely on OrderCreated for these values
    )
    return
  }

  let marketAccount = loadMarketAccount(buildMarketAccountEntityId(market, account))

  // Adjust position for invalidation
  const latestPosition = Market_v2_0Contract.bind(market).pendingPositions(account, marketAccount.latestOrderId)
  const adjustedMaker = marketAccount.pendingMaker.plus(
    latestPosition.invalidation.maker.minus(marketAccount.makerInvalidation),
  )
  const adjustedLong = marketAccount.pendingLong.plus(
    latestPosition.invalidation.long.minus(marketAccount.longInvalidation),
  )
  const adjustedShort = marketAccount.pendingShort.plus(
    latestPosition.invalidation.short.minus(marketAccount.shortInvalidation),
  )

  // Create new order for Update by comparing position size with previous position size
  const order = handleOrderCreated(
    market,
    account,
    event.params.version,
    event.params.newMaker.minus(adjustedMaker),
    event.params.newLong.minus(adjustedLong),
    event.params.newShort.minus(adjustedShort),
    event.params.collateral,
    event.transaction.hash,
    null,
    event.params.protect ? event.params.sender : null,
    event.params.protect,
    event.receipt,
  )

  // Reload Market Account
  marketAccount = loadMarketAccount(buildMarketAccountEntityId(market, account))

  // Update collateral and liquidation fee based on collateral amount
  // In v2.0.0 and v2.0.1 the collateral withdrawal amount is the liquidation fee
  const orderAccumulation = loadAccumulation(order.accumulation)
  if (order.liquidation && orderAccumulation.fee_subAccumulation_liquidation.isZero()) {
    const accumulationsToUpdate = [orderAccumulation, loadAccumulation(loadPosition(order.position).accumulation)]
    for (let i = 0; i < accumulationsToUpdate.length; i++) {
      const accumulation = accumulationsToUpdate[i]
      accumulation.fee_accumulation = accumulation.fee_accumulation.plus(event.params.collateral.abs())
      accumulation.fee_subAccumulation_liquidation = event.params.collateral.abs()
      accumulation.save()
    }
    order.collateral = order.collateral.minus(event.params.collateral)
    order.save()

    // We don't need to update the market collateral here because it is withdrawn from the market account as part of the
    // above Update
  }

  marketAccount.pendingMaker = event.params.newMaker
  marketAccount.pendingLong = event.params.newLong
  marketAccount.pendingShort = event.params.newShort
  marketAccount.makerInvalidation = latestPosition.invalidation.maker
  marketAccount.longInvalidation = latestPosition.invalidation.long
  marketAccount.shortInvalidation = latestPosition.invalidation.short

  marketAccount.save()
}

// Called for v2.2.0
export function handleUpdatedReferrer(event: UpdatedReferrerEvent): void {
  const market = event.address
  const account = event.params.account

  // If block >= v2.0.2 fork block, return early
  const fork = activeForkForNetwork(dataSource.network(), event.block.number)
  if (fork == 'v2.3') {
    return
  }
  // Pre-v2.3, we need to use the Updated event for liquidation and referrer
  handleOrderCreated(
    market,
    account,
    event.params.version,
    BigInt.zero(), // Rely on OrderCreated for these values
    BigInt.zero(),
    BigInt.zero(),
    BigInt.zero(),
    event.transaction.hash,
    event.params.referrer,
    event.params.protect ? event.params.sender : null,
    event.params.protect,
    null, // Rely on OrderCreated for these values
  )
}

export function handleOrderCreated_v2_0_2(event: OrderCreated_v2_0Event): void {
  const order = handleOrderCreated(
    event.address,
    event.params.account,
    event.params.version,
    event.params.order.maker,
    event.params.order.long,
    event.params.order.short,
    event.params.collateral,
    event.transaction.hash,
    null, // Pre-v2.3 only the Updated event has this values
    null, // Pre-v2.3 only the Updated event has this values
    false, // Pre-v2.3 only the Updated event has this values
    event.receipt,
  )

  // Update collateral and liquidation fee based on collateral amount
  // In v2.0.2 the collateral withdrawal amount is the liquidation fee
  const orderAccumulation = loadAccumulation(order.accumulation)
  if (order.liquidation && orderAccumulation.fee_subAccumulation_liquidation.isZero()) {
    const liquidationFee = event.params.collateral.abs()
    const accumulationsToUpdate = [orderAccumulation, loadAccumulation(loadPosition(order.position).accumulation)]
    for (let i = 0; i < accumulationsToUpdate.length; i++) {
      const accumulation = accumulationsToUpdate[i]
      accumulation.fee_accumulation = accumulation.fee_accumulation.plus(liquidationFee)
      accumulation.fee_subAccumulation_liquidation = accumulation.fee_subAccumulation_liquidation.plus(liquidationFee)
      accumulation.save()
    }
    order.collateral = order.collateral.minus(event.params.collateral)
    order.save()

    const marketAccount = loadMarketAccount(buildMarketAccountEntityId(event.address, event.params.account))
    marketAccount.collateral = marketAccount.collateral.minus(liquidationFee)
    marketAccount.save()
  }
}

export function handleOrderCreated_v2_1(event: OrderCreated_v2_1Event): void {
  const order = handleOrderCreated(
    event.address,
    event.params.account,
    event.params.version,
    event.params.order.maker,
    event.params.order.long,
    event.params.order.short,
    event.params.collateral,
    event.transaction.hash,
    null, // Pre-v2.3 only the Updated event has this values
    null, // Pre-v2.3 only the Updated event has this values
    false, // Pre-v2.3 only the Updated event has this values
    event.receipt,
  )

  // Update collateral and liquidation fee based on local protection amount
  const orderAccumulation = loadAccumulation(order.accumulation)
  if (order.liquidation && orderAccumulation.fee_subAccumulation_liquidation.isZero()) {
    const liquidationFee = Market_v2_1Contract.bind(event.address).locals(event.params.account).protectionAmount
    const accumulationsToUpdate = [orderAccumulation, loadAccumulation(loadPosition(order.position).accumulation)]
    for (let i = 0; i < accumulationsToUpdate.length; i++) {
      const accumulation = accumulationsToUpdate[i]
      accumulation.fee_accumulation = accumulation.fee_accumulation.plus(liquidationFee)
      accumulation.fee_subAccumulation_liquidation = accumulation.fee_subAccumulation_liquidation.plus(liquidationFee)
      accumulation.save()
    }

    const marketAccount = loadMarketAccount(buildMarketAccountEntityId(event.address, event.params.account))
    // Update the market account collateral with the liquidation fee
    marketAccount.collateral = marketAccount.collateral.minus(liquidationFee)
    marketAccount.save()
  }
}

export function handleOrderCreated_v2_2(event: OrderCreated_v2_2Event): void {
  handleOrderCreated(
    event.address,
    event.params.account,
    event.params.order.timestamp,
    event.params.order.makerPos.minus(event.params.order.makerNeg),
    event.params.order.longPos.minus(event.params.order.longNeg),
    event.params.order.shortPos.minus(event.params.order.shortNeg),
    event.params.order.collateral,
    event.transaction.hash,
    null, // Pre-v2.3 only the Updated event has this values
    null, // Pre-v2.3 only the Updated event has this values
    false, // Pre-v2.3 only the Updated event has this values
    event.receipt,
  )
}

export function handleAccountPositionProcessed_v2_0(event: AccountPositionProcessed_v2_0Event): void {
  const positionFees = event.params.accumulationResult.positionFee
  const marketPositionFee = Market_v2_0Contract.bind(event.address).parameter().positionFee
  // Offset is the position fee that does not go to the market
  const tradeFee = mul(marketPositionFee, positionFees)
  const offset = positionFees.minus(tradeFee)

  handleAccountPositionProcessed(
    event.address,
    event.params.account,
    event.params.toOracleVersion,
    event.params.toPosition,
    event.params.accumulationResult.collateralAmount,
    offset.neg(),
    tradeFee,
    event.params.accumulationResult.keeper,
    BigInt.zero(), // This is charged at order creation
    BigInt.zero(), // Subtractive fees don't exist in this version
  )
}

export function handleAccountPositionProcessed_v2_1(event: AccountPositionProcessed_v2_1Event): void {
  const positionFees = event.params.accumulationResult.positionFee
  let marketPositionFee = BigInt.zero()
  const marketPositionFeeRequest = Market_v2_1Contract.bind(event.address).try_parameter()
  // The parameter struct was changed between v2.1.0 and v2.1.1 so we need to handle the revert
  if (marketPositionFeeRequest.reverted) {
    marketPositionFee = ParamReader_2_1_0Contract.bind(event.address).parameter().positionFee
  } else {
    marketPositionFee = marketPositionFeeRequest.value.positionFee
  }

  // Offset is the position fee that does not go to the market
  const tradeFee = mul(marketPositionFee, positionFees)
  const offset = positionFees.minus(tradeFee)

  handleAccountPositionProcessed(
    event.address,
    event.params.account,
    event.params.toOracleVersion,
    event.params.toPosition,
    event.params.accumulationResult.collateralAmount,
    offset.neg(),
    tradeFee,
    event.params.accumulationResult.keeper,
    BigInt.zero(), // This is charged at order creation
    BigInt.zero(), // Subtractive fees don't exist in this version
  )
}

export function handleAccountPositionProcessed_v2_2(event: AccountPositionProcessed_v2_2Event): void {
  const linearFee = event.params.accumulationResult.linearFee
  const subtractiveFee = event.params.accumulationResult.subtractiveFee
  const marketPositionFee = Market_v2_2Contract.bind(event.address).parameter().positionFee
  // Offset is the linear fee that does not go to the market
  const tradeFee = mul(marketPositionFee, linearFee.minus(subtractiveFee)).plus(subtractiveFee)
  const offset = linearFee
    .plus(event.params.accumulationResult.proportionalFee)
    .plus(event.params.accumulationResult.adiabaticFee)
    .minus(tradeFee)

  handleAccountPositionProcessed(
    event.address,
    event.params.account,
    event.params.order.timestamp,
    event.params.orderId,
    event.params.accumulationResult.collateral,
    offset.neg(),
    tradeFee,
    event.params.accumulationResult.settlementFee,
    event.params.accumulationResult.liquidationFee,
    subtractiveFee,
  )
}

export function handlePositionProcessed_v2_0(event: PositionProcessed_v2_0Event): void {
  createMarketAccumulator(
    event.address,
    event.params.toOracleVersion,
    event.params.accumulationResult.pnlMaker,
    event.params.accumulationResult.pnlLong,
    event.params.accumulationResult.pnlShort,
    event.params.accumulationResult.fundingMaker,
    event.params.accumulationResult.fundingLong,
    event.params.accumulationResult.fundingShort,
    event.params.accumulationResult.interestMaker,
    event.params.accumulationResult.interestLong,
    event.params.accumulationResult.interestShort,
    event.params.accumulationResult.positionFeeMaker,
    BigInt.zero(), // No exposure prior to v2.2
    event.transaction.hash,
  )

  // Update position
  handlePositionProcessed(event.address, event.params.toOracleVersion, event.params.toPosition)
}

export function handlePositionProcessed_v2_1(event: PositionProcessed_v2_1Event): void {
  createMarketAccumulator(
    event.address,
    event.params.toOracleVersion,
    event.params.accumulationResult.pnlMaker,
    event.params.accumulationResult.pnlLong,
    event.params.accumulationResult.pnlShort,
    event.params.accumulationResult.fundingMaker,
    event.params.accumulationResult.fundingLong,
    event.params.accumulationResult.fundingShort,
    event.params.accumulationResult.interestMaker,
    event.params.accumulationResult.interestLong,
    event.params.accumulationResult.interestShort,
    event.params.accumulationResult.positionFeeMaker,
    BigInt.zero(), // No exposure prior to v2.2
    event.transaction.hash,
  )

  // Update position
  handlePositionProcessed(event.address, event.params.toOracleVersion, event.params.toPosition)
}

export function handlePositionProcessed_v2_2(event: PositionProcessed_v2_2Event): void {
  createMarketAccumulator(
    event.address,
    event.params.order.timestamp,
    event.params.accumulationResult.pnlMaker,
    event.params.accumulationResult.pnlLong,
    event.params.accumulationResult.pnlShort,
    event.params.accumulationResult.fundingMaker,
    event.params.accumulationResult.fundingLong,
    event.params.accumulationResult.fundingShort,
    event.params.accumulationResult.interestMaker,
    event.params.accumulationResult.interestLong,
    event.params.accumulationResult.interestShort,
    event.params.accumulationResult.positionFeeMaker,
    event.params.accumulationResult.positionFeeExposureMaker,
    event.transaction.hash,
  )

  // Update position
  handlePositionProcessed(event.address, event.params.order.timestamp, event.params.orderId)
}

// As part of the v2.2 migration, new oracles were set for the power perp markets
// We will need to create new templates for the Oracle and SubOracle for this
export function handleOracleUpdated(event: OracleUpdatedEvent): void {
  createOracleAndSubOracle(event.params.newOracle)

  const market = loadMarket(event.address)
  market.oracle = event.params.newOracle
  market.save()
}

// Business Logic
function handleOrderCreated(
  market: Address,
  account: Address,
  version: BigInt,
  maker: BigInt,
  long: BigInt,
  short: BigInt,
  collateral: BigInt,
  transactionHash: Bytes,
  referrer: Address | null,
  liquidator: Address | null,
  liquidation: boolean,
  receipt: ethereum.TransactionReceipt | null,
): OrderStore {
  // Load Related Entities
  const marketEntity = loadMarket(market)
  const oracle = loadOracle(marketEntity.oracle)
  const marketAccount = loadMarketAccount(buildMarketAccountEntityId(market, account))

  // Create position if it does not exist
  let position = createMarketAccountPosition(marketAccount)

  // Increment the currentOrderId if new version
  if (version.gt(marketAccount.currentVersion)) {
    marketAccount.currentOrderId = marketAccount.currentOrderId.plus(BigInt.fromU32(1))
  }
  marketAccount.currentVersion = version
  if (version.gt(marketEntity.currentVersion)) {
    marketEntity.currentOrderId = marketEntity.currentOrderId.plus(BigInt.fromU32(1))
  }
  marketEntity.currentVersion = version

  // If this is taking the position from zero to non-zero, increment the positionNonce and created
  // a new position entity
  const delta = accountOrderSize(maker, long, short)
  const positionMagnitude_ = positionMagnitude(position.maker, position.long, position.short)
  if (!delta.isZero() && positionMagnitude_.isZero()) {
    marketAccount.positionNonce = marketAccount.positionNonce.plus(BigInt.fromU32(1))

    // Snapshot the current collateral as the start collateral (plus initial deposit) for the position
    position = createMarketAccountPosition(marketAccount)
    position.startCollateral = marketAccount.collateral.plus(collateral)
    position.startSize = delta
  }

  // Create and update Order
  const order = createMarketAccountPositionOrder(
    market,
    account,
    position.id,
    oracle.subOracle,
    marketAccount.currentOrderId,
    marketEntity.currentOrderId,
    version,
    marketAccount.collateral,
    referrer,
    liquidator,
    liquidation,
  )
  order.maker = order.maker.plus(maker)
  order.long = order.long.plus(long)
  order.short = order.short.plus(short)
  order.collateral = order.collateral.plus(collateral)
  order.executionPrice = marketEntity.latestPrice

  // Process out of band fees (trigger order and additive fees)
  const receiptFees = processReceiptForFees(receipt, collateral, delta) // [interfaceFee, orderFee]
  if (receiptFees[0].notEqual(BigInt.zero())) {
    const accumulationsToUpdate = [loadAccumulation(order.accumulation), loadAccumulation(position.accumulation)]
    for (let i = 0; i < accumulationsToUpdate.length; i++) {
      const accumulation = accumulationsToUpdate[i]
      accumulation.fee_accumulation = accumulation.fee_accumulation.plus(receiptFees[0])
      accumulation.fee_subAccumulation_additive = accumulation.fee_subAccumulation_additive.plus(receiptFees[0])
      accumulation.save()
    }

    // Add the withdrawn collateral back to the order since it was an additive fee
    order.collateral = order.collateral.plus(receiptFees[0])
  }
  if (receiptFees[1].notEqual(BigInt.zero())) {
    const accumulationsToUpdate = [loadAccumulation(order.accumulation), loadAccumulation(position.accumulation)]
    for (let i = 0; i < accumulationsToUpdate.length; i++) {
      const accumulation = accumulationsToUpdate[i]
      accumulation.fee_accumulation = accumulation.fee_accumulation.plus(receiptFees[1])
      accumulation.fee_subAccumulation_triggerOrder = accumulation.fee_subAccumulation_triggerOrder.plus(receiptFees[1])
      accumulation.save()
    }

    // Add the withdrawn collateral back to the order since it was a trigger order fee
    order.collateral = order.collateral.plus(receiptFees[1])
  }

  // Add Transaction Hash if not already present
  const txHashes = order.transactionHashes
  if (!txHashes.includes(transactionHash)) {
    txHashes.push(transactionHash)
    order.transactionHashes = txHashes
  }

  // If the order is not associated with the current position, update the position. This can happen
  // if there are some fees charged on the position before the position is changed
  if (order.position.notEqual(position.id)) {
    order.position = position.id
  }

  // Update Position Collateral
  marketAccount.collateral = marketAccount.collateral.plus(collateral)

  const marketOrder = createMarketOrder(market, oracle.subOracle, marketEntity.currentOrderId, version)
  marketOrder.maker = marketOrder.maker.plus(maker)
  marketOrder.long = marketOrder.long.plus(long)
  marketOrder.short = marketOrder.short.plus(short)

  // Save Entities
  order.save()
  position.save()
  marketAccount.save()
  marketEntity.save()
  marketOrder.save()

  return order
}

function handlePositionProcessed(marketAddress: Address, toOracleVersion: BigInt, toOrderId: BigInt): void {
  const market = loadMarket(marketAddress)
  // The first order processed will have an orderId of 1, skip if there is a sync (positions are equal)
  if (toOrderId.isZero()) {
    market.latestVersion = toOracleVersion
    market.latestOrderId = toOrderId
    market.save()
    return
  }

  // If valid, update the market values
  if (market.latestOrderId.notEqual(toOrderId)) {
    const toOrder = loadMarketOrder(buildMarketOrderEntityId(market.id, toOrderId))

    const orderOracleVersion = loadOracleVersion(toOrder.oracleVersion)

    // As of v2.1 the fulfillment event can happen after the process event so pull from the oracle if not valid
    let oracleVersionValid = orderOracleVersion.valid
    if (!oracleVersionValid) {
      oracleVersionValid = Oracle.bind(Address.fromBytes(market.oracle)).at(toOracleVersion).valid
    }

    if (oracleVersionValid) {
      market.maker = market.maker.plus(toOrder.maker)
      market.long = market.long.plus(toOrder.long)
      market.short = market.short.plus(toOrder.short)
    }
  }

  market.latestVersion = toOracleVersion
  market.latestOrderId = toOrderId
  market.save()
}

function handleAccountPositionProcessed(
  market: Address,
  account: Address,
  toVersion: BigInt,
  toOrderId: BigInt,
  collateral: BigInt,
  offset: BigInt,
  tradeFee: BigInt,
  settlementFee: BigInt,
  liquidationFee: BigInt,
  subtractiveFees: BigInt,
): void {
  // Call `createMarketAccount` to ensure the MarketAccount entity exists (accountPositionProcessed is the first event for a new account)
  const marketAccountEntity = createMarketAccount(market, account)
  // The first order processed will have an orderId of 1
  if (toOrderId.isZero()) {
    marketAccountEntity.latestOrderId = toOrderId
    marketAccountEntity.latestVersion = toVersion
    marketAccountEntity.save()
    return
  }

  const positionFees = tradeFee.plus(settlementFee).plus(liquidationFee)

  // Update latest order accumulation values if recording first order values
  if (!marketAccountEntity.latestOrderId.isZero()) {
    const latestOrder = loadOrder(buildOrderEntityId(market, account, marketAccountEntity.latestOrderId))
    const fromPosition = loadPosition(latestOrder.position)

    const fromMarketAccumulator = loadMarketAccumulator(
      buildMarketAccumulatorId(market, marketAccountEntity.latestVersion),
    )
    const toMarketAccumulator = loadMarketAccumulator(buildMarketAccumulatorId(market, toVersion))
    const magnitude_ = positionMagnitude(marketAccountEntity.maker, marketAccountEntity.long, marketAccountEntity.short)
    const side_ = side(marketAccountEntity.maker, marketAccountEntity.long, marketAccountEntity.short)

    // Update Accumulation values
    const accumulationsToUpdate = [
      loadAccumulation(latestOrder.accumulation),
      loadAccumulation(fromPosition.accumulation),
    ]
    for (let i = 0; i < accumulationsToUpdate.length; i++) {
      const accumulation = accumulationsToUpdate[i]
      accumulation.collateral_accumulation = accumulation.collateral_accumulation.plus(collateral)
      accumulation.collateral_subAccumulation_pnl = accumulation.collateral_subAccumulation_pnl.plus(
        accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'pnl'),
      )
      accumulation.collateral_subAccumulation_funding = accumulation.collateral_subAccumulation_funding.plus(
        accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'funding'),
      )
      accumulation.collateral_subAccumulation_interest = accumulation.collateral_subAccumulation_interest.plus(
        accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'interest'),
      )
      accumulation.collateral_subAccumulation_makerPositionFee =
        accumulation.collateral_subAccumulation_makerPositionFee.plus(
          accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'positionFee'),
        )
      accumulation.collateral_subAccumulation_makerExposure =
        accumulation.collateral_subAccumulation_makerExposure.plus(
          accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'exposure'),
        )

      accumulation.save()
    }
  }

  // Update Market Account Values if transitioning to new order
  const toOrder = loadOrder(buildOrderEntityId(market, account, toOrderId))
  const toPosition = loadPosition(toOrder.position)
  const accumulationsToUpdate = [loadAccumulation(toOrder.accumulation), loadAccumulation(toPosition.accumulation)]
  for (let i = 0; i < accumulationsToUpdate.length; i++) {
    const accumulation = accumulationsToUpdate[i]
    // Offset is derived from position fees and affects collateral_accumulation of the toOrder
    accumulation.collateral_accumulation = accumulation.collateral_accumulation.plus(offset)
    accumulation.collateral_subAccumulation_offset = accumulation.collateral_subAccumulation_offset.plus(offset)

    accumulation.fee_accumulation = accumulation.fee_accumulation.plus(positionFees)
    accumulation.fee_subAccumulation_trade = accumulation.fee_subAccumulation_trade.plus(tradeFee)
    accumulation.fee_subAccumulation_settlement = accumulation.fee_subAccumulation_settlement.plus(settlementFee)
    accumulation.fee_subAccumulation_liquidation = accumulation.fee_subAccumulation_liquidation.plus(liquidationFee)

    accumulation.metadata_subtractiveFee = accumulation.metadata_subtractiveFee.plus(subtractiveFees)

    accumulation.save()
  }

  const oracleVersion = loadOracleVersion(toOrder.oracleVersion)
  if (oracleVersion.valid && marketAccountEntity.latestOrderId.notEqual(toOrderId)) {
    marketAccountEntity.maker = marketAccountEntity.maker.plus(toOrder.maker)
    marketAccountEntity.long = marketAccountEntity.long.plus(toOrder.long)
    marketAccountEntity.short = marketAccountEntity.short.plus(toOrder.short)
  }

  // Update Market Account collateral and latestVersion after process
  marketAccountEntity.collateral = marketAccountEntity.collateral.plus(collateral).plus(offset).minus(positionFees)
  marketAccountEntity.latestOrderId = toOrderId
  marketAccountEntity.latestVersion = toVersion

  // Save Entities
  toOrder.save()
  toPosition.save()
  marketAccountEntity.save()
}

// Callback to Process Order Fulfillment
export function fulfillOrder(order: OrderStore, price: BigInt): void {
  const position = loadPosition(order.position)

  // TODO: We could probably pull the market address directly from the position ID
  const marketAccount = loadMarketAccount(position.marketAccount)
  const market = loadMarket(marketAccount.market)

  let transformedPrice = price
  const marketPayoff = market.payoff
  if (marketPayoff) {
    if (marketPayoff.notEqual(ZeroAddress)) {
      const payoffContract = PayoffContract.bind(Address.fromBytes(marketPayoff))
      transformedPrice = payoffContract.payoff(price)
    }
  }

  // If order is fulfilled, update the position
  position.maker = position.maker.plus(order.maker)
  position.long = position.long.plus(order.long)
  position.short = position.short.plus(order.short)

  // Increment open size and notional if the position is increasing
  const delta = accountOrderSize(order.maker, order.long, order.short)
  const notional_ = notional(delta, transformedPrice)
  position.notional = position.notional.plus(notional_)
  if (delta.gt(BigInt.zero())) {
    position.openSize = position.openSize.plus(delta)
    position.openNotional = position.openNotional.plus(notional_)
  }

  order.executionPrice = transformedPrice
  market.latestPrice = transformedPrice

  // Save Entities
  order.save()
  position.save()
  market.save()
}

// Entity Creation
function buildMarketAccountEntityId(market: Address, account: Address): Bytes {
  return market.concat(IdSeparatorBytes).concat(account)
}
function createMarketAccount(market: Address, account: Address): MarketAccountStore {
  let accountEntity = AccountStore.load(account)
  if (!accountEntity) {
    accountEntity = new AccountStore(account)
    accountEntity.save()
  }

  const marketAccountEntityId = buildMarketAccountEntityId(market, account)
  let marketAccountEntity = MarketAccountStore.load(marketAccountEntityId)
  if (!marketAccountEntity) {
    marketAccountEntity = new MarketAccountStore(marketAccountEntityId)
    marketAccountEntity.account = account
    marketAccountEntity.market = market
    marketAccountEntity.positionNonce = BigInt.zero()
    marketAccountEntity.latestVersion = BigInt.zero()
    marketAccountEntity.currentVersion = BigInt.zero()
    marketAccountEntity.latestOrderId = BigInt.zero()
    marketAccountEntity.currentOrderId = BigInt.zero()
    marketAccountEntity.collateral = BigInt.zero()

    marketAccountEntity.maker = BigInt.zero()
    marketAccountEntity.long = BigInt.zero()
    marketAccountEntity.short = BigInt.zero()

    marketAccountEntity.pendingMaker = BigInt.zero()
    marketAccountEntity.pendingLong = BigInt.zero()
    marketAccountEntity.pendingShort = BigInt.zero()
    marketAccountEntity.makerInvalidation = BigInt.zero()
    marketAccountEntity.longInvalidation = BigInt.zero()
    marketAccountEntity.shortInvalidation = BigInt.zero()

    marketAccountEntity.save()
  }

  return marketAccountEntity
}

function buildPositionEntityId(marketAccount: MarketAccountStore): Bytes {
  return marketAccount.id.concat(IdSeparatorBytes).concat(bigIntToBytes(marketAccount.positionNonce))
}
function createMarketAccountPosition(marketAccountEntity: MarketAccountStore): PositionStore {
  const positionId = buildPositionEntityId(marketAccountEntity)
  let positionEntity = PositionStore.load(positionId)
  if (!positionEntity) {
    // Create Position
    positionEntity = new PositionStore(positionId)
    positionEntity.marketAccount = marketAccountEntity.id
    positionEntity.nonce = marketAccountEntity.positionNonce
    positionEntity.maker = BigInt.zero()
    positionEntity.long = BigInt.zero()
    positionEntity.short = BigInt.zero()
    positionEntity.startCollateral = BigInt.zero()
    positionEntity.startSize = BigInt.zero()
    positionEntity.openSize = BigInt.zero()
    positionEntity.openNotional = BigInt.zero()
    positionEntity.accumulation = createAccumulation(positionId).id

    positionEntity.save()
  }

  return positionEntity
}

function buildOrderEntityId(market: Bytes, account: Bytes, orderId: BigInt): Bytes {
  return market.concat(IdSeparatorBytes).concat(account).concat(IdSeparatorBytes).concat(bigIntToBytes(orderId))
}
function createMarketAccountPositionOrder(
  market: Bytes,
  account: Bytes,
  marketAccountPositionId: Bytes,
  subOracleAddress: Bytes,
  orderId: BigInt,
  marketOrderId: BigInt,
  oracleVersion: BigInt,
  newEntity_startCollateral: BigInt,
  newEntity_referrer: Bytes | null,
  newEntity_liquidator: Bytes | null,
  newEntity_liquidation: boolean,
): OrderStore {
  const entityId = buildOrderEntityId(market, account, orderId)

  let orderEntity = OrderStore.load(entityId)
  if (!orderEntity) {
    // Create Order
    orderEntity = new OrderStore(entityId)
    orderEntity.position = marketAccountPositionId
    orderEntity.orderId = orderId
    orderEntity.marketOrder = buildMarketOrderEntityId(market, marketOrderId)
    orderEntity.account = account
    orderEntity.market = market

    orderEntity.referrer = newEntity_referrer ? newEntity_referrer : ZeroAddress
    orderEntity.liquidator = newEntity_liquidator ? newEntity_liquidator : ZeroAddress
    orderEntity.liquidation = newEntity_liquidation

    orderEntity.maker = BigInt.zero()
    orderEntity.long = BigInt.zero()
    orderEntity.short = BigInt.zero()
    orderEntity.collateral = BigInt.zero()
    orderEntity.startCollateral = newEntity_startCollateral
    orderEntity.transactionHashes = []

    orderEntity.accumulation = createAccumulation(entityId).id

    // If we are creating an oracle version here, it is unrequested because the request comes before the OrderCreated event
    const oracleVersionEntity = getOrCreateOracleVersion(subOracleAddress, oracleVersion, false, null)
    orderEntity.oracleVersion = oracleVersionEntity.id
    orderEntity.executionPrice = BigInt.zero()

    orderEntity.save()
  }

  let updated = false
  if (!orderEntity.liquidation && newEntity_liquidation) {
    updated = true
    orderEntity.liquidation = newEntity_liquidation
  }
  if (orderEntity.liquidator.equals(ZeroAddress) && newEntity_liquidator) {
    updated = true
    orderEntity.liquidator = newEntity_liquidator
  }
  if (orderEntity.referrer.equals(ZeroAddress) && newEntity_referrer) {
    updated = true
    orderEntity.referrer = newEntity_referrer
  }

  if (updated) orderEntity.save()

  return orderEntity
}

function buildMarketOrderEntityId(market: Bytes, orderId: BigInt): Bytes {
  return market.concat(IdSeparatorBytes).concat(bigIntToBytes(orderId))
}
function createMarketOrder(
  market: Bytes,
  subOracleAddress: Bytes,
  orderId: BigInt,
  oracleVersion: BigInt,
): MarketOrderStore {
  const entityId = buildMarketOrderEntityId(market, orderId)

  let marketOrderEntity = MarketOrderStore.load(entityId)
  if (!marketOrderEntity) {
    // Create Order
    marketOrderEntity = new MarketOrderStore(entityId)
    marketOrderEntity.market = market
    marketOrderEntity.orderId = orderId
    marketOrderEntity.version = oracleVersion
    marketOrderEntity.maker = BigInt.zero()
    marketOrderEntity.long = BigInt.zero()
    marketOrderEntity.short = BigInt.zero()

    const oracleVersionEntity = getOrCreateOracleVersion(subOracleAddress, oracleVersion, false, null)
    marketOrderEntity.oracleVersion = oracleVersionEntity.id

    marketOrderEntity.save()
  }

  return marketOrderEntity
}

function buildMarketAccumulatorId(market: Address, version: BigInt): Bytes {
  return market.concat(IdSeparatorBytes).concat(bigIntToBytes(version))
}
function createMarketAccumulator(
  market: Address,
  toVersion: BigInt,
  pnlMaker: BigInt,
  pnlLong: BigInt,
  pnlShort: BigInt,
  fundingMaker: BigInt,
  fundingLong: BigInt,
  fundingShort: BigInt,
  interestMaker: BigInt,
  interestLong: BigInt,
  interestShort: BigInt,
  positionFeeMaker: BigInt,
  exposureMaker: BigInt,
  transactionHash: Bytes,
): void {
  const marketEntity = loadMarket(market)

  const fromId = buildMarketAccumulatorId(market, marketEntity.latestVersion)
  const toId = buildMarketAccumulatorId(market, toVersion)
  const fromAccumulator = MarketAccumulatorStore.load(fromId)
  let entity = new MarketAccumulatorStore(toId)

  entity.market = market
  entity.version = toVersion

  // Accumulate the values
  entity.pnlMaker = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.pnlMaker,
    pnlMaker,
    marketEntity.maker,
  )
  entity.pnlLong = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.pnlLong,
    pnlLong,
    marketEntity.long,
  )
  entity.pnlShort = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.pnlShort,
    pnlShort,
    marketEntity.short,
  )
  entity.fundingMaker = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.fundingMaker,
    fundingMaker,
    marketEntity.maker,
  )
  entity.fundingLong = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.fundingLong,
    fundingLong,
    marketEntity.long,
  )
  entity.fundingShort = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.fundingShort,
    fundingShort,
    marketEntity.short,
  )
  entity.interestMaker = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.interestMaker,
    interestMaker,
    marketEntity.maker,
  )
  entity.interestLong = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.interestLong,
    interestLong,
    marketEntity.long,
  )
  entity.interestShort = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.interestShort,
    interestShort,
    marketEntity.short,
  )
  entity.positionFeeMaker = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.positionFeeMaker,
    positionFeeMaker,
    marketEntity.maker,
  )
  entity.exposureMaker = accumulatorIncrement(
    fromAccumulator === null ? BigInt.zero() : fromAccumulator.exposureMaker,
    exposureMaker,
    marketEntity.maker,
  )

  entity.transactionHash = transactionHash

  entity.save()
}

function createAccumulation(id: Bytes): AccumulationStore {
  let entity = AccumulationStore.load(id)
  if (!entity) {
    entity = new AccumulationStore(id)

    entity.collateral_accumulation = BigInt.zero()
    entity.fee_accumulation = BigInt.zero()

    entity.collateral_subAccumulation_offset = BigInt.zero()
    entity.collateral_subAccumulation_pnl = BigInt.zero()
    entity.collateral_subAccumulation_funding = BigInt.zero()
    entity.collateral_subAccumulation_interest = BigInt.zero()
    entity.collateral_subAccumulation_makerPositionFee = BigInt.zero()
    entity.collateral_subAccumulation_makerExposure = BigInt.zero()

    entity.fee_subAccumulation_trade = BigInt.zero()
    entity.fee_subAccumulation_settlement = BigInt.zero()
    entity.fee_subAccumulation_liquidation = BigInt.zero()
    entity.fee_subAccumulation_additive = BigInt.zero()
    entity.fee_subAccumulation_triggerOrder = BigInt.zero()

    entity.metadata_subtractiveFee = BigInt.zero()

    entity.save()
  }

  return entity
}
