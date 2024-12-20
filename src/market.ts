import { Bytes, Address, BigInt, dataSource, ethereum } from '@graphprotocol/graph-ts'
import { log } from '@graphprotocol/graph-ts'

import {
  Updated as UpdatedEvent,
  Updated1 as UpdatedReferrerEvent,
  OrderCreated as OrderCreated_v2_0Event,
  OrderCreated1 as OrderCreated_v2_1Event,
  OrderCreated2 as OrderCreated_v2_2Event,
  OrderCreated3 as OrderCreated_v2_3Event,
  OracleUpdated as OracleUpdatedEvent,
  AccountPositionProcessed1 as AccountPositionProcessed_v2_0Event,
  AccountPositionProcessed as AccountPositionProcessed_v2_1Event,
  AccountPositionProcessed2 as AccountPositionProcessed_v2_2Event,
  AccountPositionProcessed3 as AccountPositionProcessed_v2_3Event,
  PositionProcessed as PositionProcessed_v2_0Event,
  PositionProcessed1 as PositionProcessed_v2_1Event,
  PositionProcessed2 as PositionProcessed_v2_2Event,
  PositionProcessed3 as PositionProcessed_v2_3Event,
} from '../generated/templates/Market/Market'
import {
  Account as AccountStore,
  MarketAccount as MarketAccountStore,
  Position as PositionStore,
  Order as OrderStore,
  MarketOrder as MarketOrderStore,
  MarketAccumulator as MarketAccumulatorStore,
  OrderAccumulation as OrderAccumulationStore,
  MarketSocializationPeriod as MarketSocializationPeriodStore,
} from '../generated/schema'
import { Market_v2_0 as Market_v2_0Contract } from '../generated/templates/Market/Market_v2_0'
import { Market_v2_1 as Market_v2_1Contract } from '../generated/templates/Market/Market_v2_1'
import { ParamReader_2_1_0 as ParamReader_2_1_0Contract } from '../generated/templates/Market/ParamReader_2_1_0'
import { Market_v2_2 as Market_v2_2Contract } from '../generated/templates/Market/Market_v2_2'
import { Oracle_v2_3 as Oracle_v2_3Contract } from '../generated/templates/Market/Oracle_v2_3'
import { Payoff as PayoffContract } from '../generated/templates/Market/Payoff'
import { Oracle } from '../generated/templates/Oracle/Oracle'

import { Buckets, IdSeparatorBytes, SecondsPerYear, ZeroAddress } from './util/constants'
import { accountOrderSize, bigIntToBytes, isTaker, notional, positionMagnitude, side, timestampToBucket } from './util'
import {
  loadOrderAccumulation,
  loadMarket,
  loadMarketAccount,
  loadMarketAccumulator,
  loadMarketOrder,
  loadOracle,
  loadOracleVersion,
  loadOrder,
  loadPosition,
} from './util/loadOrThrow'
import {
  buildMarketAccountEntityId,
  loadOrCreateAccountAccumulation,
  loadOrCreateMarketAccount,
  loadOrCreateMarketAccountAccumulation,
  loadOrCreateMarketAccumulation,
  loadOrCreateOrderAccumulation,
  loadOrCreateProtocolAccumulation,
} from './util/loadOrCreate'
import { getOrCreateOracleVersion } from './subOracle'
import { createOracleAndSubOracle } from './market-factory'
import { activeForkForNetwork, Fork, isV2_2OrLater, isV2_3OrLater } from './util/forks'
import { mul, div } from './util/big6Math'
import { accumulatorAccumulated, accumulatorIncrement } from './util/accumulatorMath'
import { processReceiptForFees } from './util/receiptFees'

// Event Handler Entrypoints
// Called for v2.0.0 to 2.1.0
export function handleUpdated(event: UpdatedEvent): void {
  const market = event.address
  const account = event.params.account

  // If block >= v2.0.2 fork block, return early
  const fork = activeForkForNetwork(dataSource.network(), event.block.number)
  if (fork != Fork.v2_0_1) {
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
      null, // No guarantee price in this version
      null, // No guarantee referrer in this version
      false, // No guarantee solve for this version
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
    null, // No guarantee price in this version
    null, // No guarantee referrer in this version
    false, // No guarantee solve for this version
    event.receipt,
  )

  // Reload Market Account
  marketAccount = loadMarketAccount(buildMarketAccountEntityId(market, account))

  // Update collateral and liquidation fee based on collateral amount
  // In v2.0.0 and v2.0.1 the collateral withdrawal amount is the liquidation fee
  const orderAccumulation = loadOrderAccumulation(order.accumulation)
  if (order.liquidation && orderAccumulation.fee_subAccumulation_liquidation.isZero()) {
    orderAccumulation.fee_accumulation = orderAccumulation.fee_accumulation.plus(event.params.collateral.abs())
    orderAccumulation.fee_subAccumulation_liquidation = event.params.collateral.abs()

    updateSummedOrderAccumulation(loadPosition(order.position).accumulation, orderAccumulation)
    accumulateMarketAccount(
      marketAccount,
      order.timestamp,
      orderAccumulation,
      order.referrer,
      order.guaranteeReferrer,
      order.maker.isZero(),
    )

    order.collateral = order.collateral.minus(event.params.collateral)
    order.save()

    // We don't need to update the market collateral here because it is withdrawn from the market account as part of the above Update
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
    null, // No guarantee price in this version
    null, // No guarantee referrer in this version
    false, // No guarantee solve for this version
    null, // Receipt is not needed for this event
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
    null, // No guarantee price in this version
    null, // No guarantee referrer in this version
    false, // No guarantee solve for this version
    event.receipt,
  )

  // Update collateral and liquidation fee based on collateral amount
  // In v2.0.2 the collateral withdrawal amount is the liquidation fee
  const orderAccumulation = loadOrderAccumulation(order.accumulation)
  if (order.liquidation && orderAccumulation.fee_subAccumulation_liquidation.isZero()) {
    const liquidationFee = event.params.collateral.abs()
    const marketAccount = loadMarketAccount(buildMarketAccountEntityId(event.address, event.params.account))

    orderAccumulation.fee_accumulation = orderAccumulation.fee_accumulation.plus(liquidationFee)
    orderAccumulation.fee_subAccumulation_liquidation =
      orderAccumulation.fee_subAccumulation_liquidation.plus(liquidationFee)

    updateSummedOrderAccumulation(loadPosition(order.position).accumulation, orderAccumulation)
    accumulateMarketAccount(
      marketAccount,
      order.timestamp,
      orderAccumulation,
      order.referrer,
      order.guaranteeReferrer,
      order.maker.isZero(),
    )
    orderAccumulation.save()

    order.collateral = order.collateral.minus(event.params.collateral)
    order.save()

    // We don't need to update the market collateral here because it is withdrawn from the market account as part of the above OrderCreated
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
    null, // No guarantee price in this version
    null, // No guarantee referrer in this version
    false, // No guarantee solve for this version
    event.receipt,
  )

  // Update collateral and liquidation fee based on local protection amount
  const orderAccumulation = loadOrderAccumulation(order.accumulation)
  if (order.liquidation && orderAccumulation.fee_subAccumulation_liquidation.isZero()) {
    const marketAccount = loadMarketAccount(buildMarketAccountEntityId(event.address, event.params.account))
    const liquidationFee = Market_v2_1Contract.bind(event.address).locals(event.params.account).protectionAmount

    orderAccumulation.fee_accumulation = orderAccumulation.fee_accumulation.plus(liquidationFee)
    orderAccumulation.fee_subAccumulation_liquidation =
      orderAccumulation.fee_subAccumulation_liquidation.plus(liquidationFee)

    updateSummedOrderAccumulation(loadPosition(order.position).accumulation, orderAccumulation)
    accumulateMarketAccount(
      marketAccount,
      order.timestamp,
      orderAccumulation,
      order.referrer,
      order.guaranteeReferrer,
      order.makerTotal.isZero(),
    )
    orderAccumulation.save()

    // Update the market account collateral with the liquidation fee
    marketAccount.collateral = marketAccount.collateral.minus(liquidationFee)
    marketAccount.save()

    // TODO: credit the liquidation fee to the liquidator?
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
    null, // No guarantee price in this version
    null, // No guarantee referrer in this version
    false, // No guarantee solve for this version
    event.receipt,
  )

  // We don't need any special case liquidation handling here as it is all handled in the AccountPositionProcessed event
}

export function handleOrderCreated_v2_3(event: OrderCreated_v2_3Event): void {
  const guaranteeNotional = event.params.guarantee.notional
  const guaranteeSize = event.params.guarantee.takerPos.minus(event.params.guarantee.takerNeg)
  const isGuaranteeSolve = !guaranteeSize.isZero() && event.params.guarantee.orders.isZero()

  handleOrderCreated(
    event.address,
    event.params.account,
    event.params.order.timestamp,
    event.params.order.makerPos.minus(event.params.order.makerNeg),
    event.params.order.longPos.minus(event.params.order.longNeg),
    event.params.order.shortPos.minus(event.params.order.shortNeg),
    event.params.order.collateral,
    event.transaction.hash,
    event.params.orderReferrer,
    event.params.liquidator,
    event.params.liquidator.notEqual(Address.zero()),
    guaranteeSize.isZero() ? null : div(guaranteeNotional, guaranteeSize),
    event.params.guaranteeReferrer,
    isGuaranteeSolve,
    event.receipt,
  )
  // We don't need any special case liquidation handling here as it is all handled in the AccountPositionProcessed event
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
    BigInt.zero(), // No solver fee in this version
    BigInt.zero(), // No price override in this version
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
    BigInt.zero(), // No solver fee in this version
    BigInt.zero(), // No price override in this version
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
    BigInt.zero(), // No solver fee in this version
    BigInt.zero(), // No price override in this version
  )
}

export function handleAccountPositionProcessed_v2_3(event: AccountPositionProcessed_v2_3Event): void {
  const subtractiveFee = event.params.accumulationResult.subtractiveFee
  const tradeFee = event.params.accumulationResult.tradeFee
  const offset = event.params.accumulationResult.offset

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
    event.params.accumulationResult.solverFee,
    event.params.accumulationResult.priceOverride,
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
  handlePositionProcessed(
    event.address,
    event.params.toOracleVersion,
    event.params.toPosition,
    event.params.accumulationResult.positionFeeFee,
    event.params.accumulationResult.fundingFee,
    event.params.accumulationResult.interestFee,
    BigInt.zero(), // No exposure prior to v2.2
    event.block.number,
  )
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
  handlePositionProcessed(
    event.address,
    event.params.toOracleVersion,
    event.params.toPosition,
    event.params.accumulationResult.positionFeeFee,
    event.params.accumulationResult.fundingFee,
    event.params.accumulationResult.interestFee,
    BigInt.zero(), // No exposure prior to v2.2
    event.block.number,
  )
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
  handlePositionProcessed(
    event.address,
    event.params.order.timestamp,
    event.params.orderId,
    event.params.accumulationResult.positionFeeProtocol,
    event.params.accumulationResult.fundingFee,
    event.params.accumulationResult.interestFee,
    event.params.accumulationResult.positionFeeExposureProtocol,
    event.block.number,
  )
}

export function handlePositionProcessed_v2_3(event: PositionProcessed_v2_3Event): void {
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
    event.params.accumulationResult.tradeOffsetMaker,
    event.params.accumulationResult.adiabaticExposureMaker,
    event.transaction.hash,
  )

  // Update position
  handlePositionProcessed(
    event.address,
    event.params.order.timestamp,
    event.params.orderId,
    event.params.accumulationResult.tradeFee.plus(event.params.accumulationResult.tradeOffsetMarket),
    event.params.accumulationResult.fundingFee,
    event.params.accumulationResult.interestFee,
    event.params.accumulationResult.adiabaticExposureMarket,
    event.block.number,
  )
}

// As part of the v2.2 migration, new oracles were set for the power perp markets
// We will need to create new templates for the Oracle and SubOracle for this
export function handleOracleUpdated(event: OracleUpdatedEvent): void {
  createOracleAndSubOracle(event.params.newOracle)

  const market = loadMarket(event.address)
  market.oracle = event.params.newOracle
  // After v2.2 the payoff contract is no longer used
  if (isV2_2OrLater(dataSource.network(), event.block.number)) market.payoff = ZeroAddress
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
  guaranteePrice: BigInt | null,
  guaranteeReferrer: Address | null,
  guaranteeSolve: boolean,
  receipt: ethereum.TransactionReceipt | null,
): OrderStore {
  // Load Related Entities
  const marketEntity = loadMarket(market)
  const oracle = loadOracle(marketEntity.oracle)
  const marketAccountEntityId = buildMarketAccountEntityId(market, account)
  let marketAccount = MarketAccountStore.load(marketAccountEntityId)
  // Generally the market account will exist, but there is a case where the very first interaction with the market results
  // an order created event without PositionProcessed event. In this case, loadOrCreateMarketAccount will create the
  // MarketAccount entity and set the initial accumulator
  if (!marketAccount) {
    marketAccount = loadOrCreateMarketAccount(market, account)
  }

  // Create the accumulator if it does not exist
  const toId = buildMarketAccumulatorId(market, version)
  let accumulator = MarketAccumulatorStore.load(toId)
  if (!accumulator) {
    createMarketAccumulator(
      market,
      version,
      BigInt.zero(),
      BigInt.zero(),
      BigInt.zero(),
      BigInt.zero(),
      BigInt.zero(),
      BigInt.zero(),
      BigInt.zero(),
      BigInt.zero(),
      BigInt.zero(),
      BigInt.zero(),
      BigInt.zero(),
      receipt ? receipt.transactionHash : Bytes.empty(),
    )
  }

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
    position.startCollateral = marketAccount.collateral
    position.startMaker = maker
    position.startLong = long
    position.startShort = short
    position.startVersion = version
  }

  // Collateral delta can be modified when detecting additive and trigger order fees
  let finalCollateralDelta = collateral
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
    guaranteeReferrer,
  )
  // Update Order Deltas
  order.maker = order.maker.plus(maker)
  order.long = order.long.plus(long)
  order.short = order.short.plus(short)

  // Update Order Totals
  order.makerTotal = order.makerTotal.plus(maker.abs())
  order.longTotal = order.longTotal.plus(long.abs())
  order.shortTotal = order.shortTotal.plus(short.abs())

  // Set Guarantee Price if present
  if (guaranteePrice) order.guaranteePrice = guaranteePrice
  order.guaranteeSolve = guaranteeSolve

  order.executionPrice = marketEntity.latestPrice
  order.newMaker = position.maker
  order.newLong = position.long
  order.newShort = position.short

  // Process out of band fees (trigger order and additive fees)
  const receiptFees = processReceiptForFees(receipt, collateral, delta) // [interfaceFee, orderFee]
  if (receiptFees[0].notEqual(BigInt.zero())) {
    const orderAccumulation = loadOrderAccumulation(order.accumulation)

    orderAccumulation.fee_accumulation = orderAccumulation.fee_accumulation.plus(receiptFees[0])
    orderAccumulation.fee_subAccumulation_additive = orderAccumulation.fee_subAccumulation_additive.plus(receiptFees[0])

    updateSummedOrderAccumulation(position.accumulation, orderAccumulation)
    accumulateMarketAccount(
      marketAccount,
      order.timestamp,
      orderAccumulation,
      order.referrer,
      order.guaranteeReferrer,
      order.makerTotal.isZero(),
    )
    orderAccumulation.save()

    // Add the withdrawn collateral back to the collateral since it was an additive fee
    finalCollateralDelta = finalCollateralDelta.plus(receiptFees[0])
  }
  if (receiptFees[1].notEqual(BigInt.zero())) {
    const orderAccumulation = loadOrderAccumulation(order.accumulation)

    orderAccumulation.fee_accumulation = orderAccumulation.fee_accumulation.plus(receiptFees[1])
    orderAccumulation.fee_subAccumulation_triggerOrder = orderAccumulation.fee_subAccumulation_triggerOrder.plus(
      receiptFees[1],
    )

    updateSummedOrderAccumulation(position.accumulation, orderAccumulation)
    accumulateMarketAccount(
      marketAccount,
      order.timestamp,
      orderAccumulation,
      order.referrer,
      order.guaranteeReferrer,
      order.makerTotal.isZero(),
    )
    orderAccumulation.save()

    // Add the withdrawn collateral back to the collateral since it was a trigger order fee
    finalCollateralDelta = finalCollateralDelta.plus(receiptFees[1])
  }

  // Add Transaction Hash if not already present
  const txHashes = order.transactionHashes
  if (!txHashes.includes(transactionHash)) {
    txHashes.push(transactionHash)
    order.transactionHashes = txHashes
  }

  // If the order is not associated with the current position, update the position. This can happen
  // if there are some fees charged on the position before the position is changed
  if (order.position.notEqual(position.id)) order.position = position.id

  // Record the final collateral delta for the order
  order.collateral = order.collateral.plus(finalCollateralDelta)
  order.endCollateral = order.startCollateral.plus(order.collateral)
  if (finalCollateralDelta.gt(BigInt.zero())) order.depositTotal = order.depositTotal.plus(finalCollateralDelta.abs())
  if (finalCollateralDelta.lt(BigInt.zero()))
    order.withdrawalTotal = order.withdrawalTotal.plus(finalCollateralDelta.abs())

  // If this is an order occurring at the start of a new position, add the collateral to the start collateral
  if (position.startVersion.equals(version))
    position.startCollateral = position.startCollateral.plus(finalCollateralDelta)
  else position.netDeposits = position.netDeposits.plus(finalCollateralDelta)

  // Update Position Collateral - use collateral directly here as the market account is simply recording the
  // total collateral change which includes all additive fees
  marketAccount.collateral = marketAccount.collateral.plus(collateral)

  const marketOrder = createMarketOrder(market, oracle.subOracle, marketEntity.currentOrderId, version)
  marketOrder.maker = marketOrder.maker.plus(maker)
  marketOrder.long = marketOrder.long.plus(long)
  marketOrder.short = marketOrder.short.plus(short)

  marketOrder.newMaker = marketEntity.maker
  marketOrder.newLong = marketEntity.long
  marketOrder.newShort = marketEntity.short

  marketOrder.makerTotal = marketOrder.makerTotal.plus(maker.abs())
  marketOrder.longTotal = marketOrder.longTotal.plus(long.abs())
  marketOrder.shortTotal = marketOrder.shortTotal.plus(short.abs())

  // Save Entities
  order.save()
  position.save()
  marketAccount.save()
  marketEntity.save()
  marketOrder.save()

  return order
}

function handlePositionProcessed(
  marketAddress: Address,
  toOracleVersion: BigInt,
  toOrderId: BigInt,
  positionFeeMarket: BigInt,
  fundingMarket: BigInt,
  interestMarket: BigInt,
  exposureMarket: BigInt,
  blockNumber: BigInt,
): void {
  const market = loadMarket(marketAddress)
  // The first order processed will have an orderId of 1, skip if there is a sync (positions are equal)
  if (toOrderId.isZero()) {
    market.latestVersion = toOracleVersion
    market.latestOrderId = toOrderId
    market.save()
    return
  }

  if (market.latestOrderId.notEqual(toOrderId)) {
    const toOrder = loadMarketOrder(buildMarketOrderEntityId(market.id, toOrderId))
    const orderOracleVersion = loadOracleVersion(toOrder.oracleVersion)

    // As of v2.1 the fulfillment event can happen after the process event so pull from the oracle if not valid
    // This is fixed in v2.3
    let oracleVersionValid = orderOracleVersion.valid
    if (!oracleVersionValid) {
      if (isV2_3OrLater(dataSource.network(), blockNumber)) {
        oracleVersionValid = Oracle_v2_3Contract.bind(Address.fromBytes(market.oracle))
          .at(toOracleVersion)
          .getAtVersion().valid
      } else {
        oracleVersionValid = Oracle.bind(Address.fromBytes(market.oracle)).at(toOracleVersion).valid
      }
    }

    // If valid, update the market values
    if (oracleVersionValid) {
      market.maker = market.maker.plus(toOrder.maker)
      market.long = market.long.plus(toOrder.long)
      market.short = market.short.plus(toOrder.short)

      // If the market is socialized, create a new socialization period
      const major = market.long.gt(market.short) ? market.long : market.short
      const minor = market.long.lt(market.short) ? market.long : market.short
      const maker = market.maker
      const currentSocializationPeriod = market.currentSocializationPeriod
      if (major.gt(market.maker.plus(minor))) {
        const newSocializationPeriodId = market.id.concat(IdSeparatorBytes).concat(bigIntToBytes(toOracleVersion))
        const newSocializationPeriod = new MarketSocializationPeriodStore(newSocializationPeriodId)
        newSocializationPeriod.market = market.id
        newSocializationPeriod.startVersion = toOracleVersion
        newSocializationPeriod.maker = maker
        newSocializationPeriod.long = market.long
        newSocializationPeriod.short = market.short
        newSocializationPeriod.save()

        // End the current socialization period to record the new one with updated position values
        if (currentSocializationPeriod !== null) {
          const socializationPeriod = MarketSocializationPeriodStore.load(currentSocializationPeriod)
          if (socializationPeriod) {
            socializationPeriod.endVersion = toOracleVersion
            socializationPeriod.save()
          }
        }

        market.currentSocializationPeriod = newSocializationPeriodId
      } else {
        // End the current socialization period
        if (currentSocializationPeriod !== null) {
          const socializationPeriod = MarketSocializationPeriodStore.load(currentSocializationPeriod)
          if (socializationPeriod) {
            socializationPeriod.endVersion = toOracleVersion
            socializationPeriod.save()
          }
        }
        market.currentSocializationPeriod = null
      }
    }
  }

  market.latestVersion = toOracleVersion
  market.latestOrderId = toOrderId
  market.save()

  accumulateMarket(market.id, toOracleVersion, positionFeeMarket, fundingMarket, interestMarket, exposureMarket)
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
  solverFee: BigInt,
  priceOverride: BigInt,
): void {
  if (account.equals(ZeroAddress)) {
    log.warning(
      'handleAccountPositionProcessed is processing a position for account 0x0 in market {} with collateral {}',
      [market.toHexString(), collateral.toString()],
    )
  }

  // Call `createMarketAccount` to ensure the MarketAccount entity exists (accountPositionProcessed is the first event for a new account)
  const marketAccountEntity = loadOrCreateMarketAccount(market, account)

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
    const latestOrder = loadOrder(buildOrderId(market, account, marketAccountEntity.latestOrderId))
    const fromPosition = loadPosition(latestOrder.position)

    const fromMarketAccumulator = loadMarketAccumulator(
      buildMarketAccumulatorId(market, marketAccountEntity.latestVersion),
    )
    const toMarketAccumulator = loadMarketAccumulator(buildMarketAccumulatorId(market, toVersion))
    const magnitude_ = positionMagnitude(marketAccountEntity.maker, marketAccountEntity.long, marketAccountEntity.short)
    const side_ = side(marketAccountEntity.maker, marketAccountEntity.long, marketAccountEntity.short)

    // Update Accumulation values
    const orderAccumulation = loadOrderAccumulation(latestOrder.accumulation)
    orderAccumulation.collateral_accumulation = orderAccumulation.collateral_accumulation.plus(collateral)
    orderAccumulation.collateral_subAccumulation_pnl = orderAccumulation.collateral_subAccumulation_pnl.plus(
      accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'pnl'),
    )
    orderAccumulation.collateral_subAccumulation_funding = orderAccumulation.collateral_subAccumulation_funding.plus(
      accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'funding'),
    )
    orderAccumulation.collateral_subAccumulation_interest = orderAccumulation.collateral_subAccumulation_interest.plus(
      accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'interest'),
    )
    orderAccumulation.collateral_subAccumulation_makerPositionFee =
      orderAccumulation.collateral_subAccumulation_makerPositionFee.plus(
        accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'positionFee'),
      )
    orderAccumulation.collateral_subAccumulation_makerExposure =
      orderAccumulation.collateral_subAccumulation_makerExposure.plus(
        accumulatorAccumulated(toMarketAccumulator, fromMarketAccumulator, magnitude_, side_, 'exposure'),
      )
    orderAccumulation.metadata_net = orderAccumulation.collateral_accumulation.minus(orderAccumulation.fee_accumulation)

    updateSummedOrderAccumulation(fromPosition.accumulation, orderAccumulation)
    accumulateMarketAccount(
      marketAccountEntity,
      latestOrder.timestamp,
      orderAccumulation,
      latestOrder.referrer,
      latestOrder.guaranteeReferrer,
      latestOrder.makerTotal.isZero(),
    )
    orderAccumulation.save()
  }

  // Update Market Account Values if transitioning to new order
  const toOrder = loadOrder(buildOrderId(market, account, toOrderId))
  const toPosition = loadPosition(toOrder.position)
  const orderAccumulation = loadOrderAccumulation(toOrder.accumulation)
  // Offset is derived from position fees and affects collateral_accumulation of the toOrder
  orderAccumulation.collateral_accumulation = orderAccumulation.collateral_accumulation.plus(offset)
  orderAccumulation.collateral_accumulation = orderAccumulation.collateral_accumulation.plus(priceOverride)
  orderAccumulation.collateral_subAccumulation_offset = orderAccumulation.collateral_subAccumulation_offset.plus(offset)
  orderAccumulation.collateral_subAccumulation_priceOverride =
    orderAccumulation.collateral_subAccumulation_priceOverride.plus(priceOverride)

  orderAccumulation.fee_accumulation = orderAccumulation.fee_accumulation.plus(positionFees)
  orderAccumulation.fee_subAccumulation_trade = orderAccumulation.fee_subAccumulation_trade.plus(tradeFee)
  orderAccumulation.fee_subAccumulation_settlement =
    orderAccumulation.fee_subAccumulation_settlement.plus(settlementFee)
  orderAccumulation.fee_subAccumulation_liquidation =
    orderAccumulation.fee_subAccumulation_liquidation.plus(liquidationFee)

  orderAccumulation.metadata_subtractiveFee = orderAccumulation.metadata_subtractiveFee.plus(subtractiveFees)
  orderAccumulation.metadata_solverFee = orderAccumulation.metadata_solverFee.plus(solverFee)
  orderAccumulation.metadata_net = orderAccumulation.collateral_accumulation.minus(orderAccumulation.fee_accumulation)

  updateSummedOrderAccumulation(toPosition.accumulation, orderAccumulation)
  accumulateMarketAccount(
    marketAccountEntity,
    toOrder.timestamp,
    orderAccumulation,
    toOrder.referrer,
    toOrder.guaranteeReferrer,
    toOrder.makerTotal.isZero(),
  )
  orderAccumulation.save()

  const delta = accountOrderSize(toOrder.maker, toOrder.long, toOrder.short)
  if (delta.gt(BigInt.zero())) toPosition.openOffset = toPosition.openOffset.plus(offset)
  else if (delta.lt(BigInt.zero())) toPosition.closeOffset = toPosition.closeOffset.plus(offset)

  const oracleVersion = loadOracleVersion(toOrder.oracleVersion)
  if (oracleVersion.valid && marketAccountEntity.latestOrderId.notEqual(toOrderId)) {
    marketAccountEntity.maker = marketAccountEntity.maker.plus(toOrder.maker)
    marketAccountEntity.long = marketAccountEntity.long.plus(toOrder.long)
    marketAccountEntity.short = marketAccountEntity.short.plus(toOrder.short)
  }

  // Update Market Account collateral and latestVersion after process
  marketAccountEntity.collateral = marketAccountEntity.collateral
    .plus(collateral)
    .plus(offset)
    .minus(positionFees)
    .plus(priceOverride)
  marketAccountEntity.latestOrderId = toOrderId
  marketAccountEntity.latestVersion = toVersion

  // Save Entities
  toOrder.save()
  toPosition.save()
  marketAccountEntity.save()
}

// Callback to Process Order Fulfillment
export function fulfillOrder(order: OrderStore, price: BigInt, oracleVersionTimestamp: BigInt): void {
  const position = loadPosition(order.position)
  const marketAccount = loadMarketAccount(position.marketAccount)
  const market = loadMarket(marketAccount.market)
  const marketOrder = loadMarketOrder(order.marketOrder)

  let transformedPrice = price
  const marketPayoff = market.payoff
  if (marketPayoff && marketPayoff.notEqual(ZeroAddress)) {
    const payoffContract = PayoffContract.bind(Address.fromBytes(marketPayoff))
    transformedPrice = payoffContract.payoff(price)
  }
  const orderGuaranteePrice = order.guaranteePrice

  // If order is fulfilled, optimistically update the position and order values
  position.maker = position.maker.plus(order.maker)
  position.long = position.long.plus(order.long)
  position.short = position.short.plus(order.short)
  order.newMaker = position.maker
  order.newLong = position.long
  order.newShort = position.short
  marketOrder.newMaker = marketOrder.newMaker.plus(order.maker)
  marketOrder.newLong = marketOrder.newLong.plus(order.long)
  marketOrder.newShort = marketOrder.newShort.plus(order.short)

  // Increment open size and notional if the position is increasing
  const delta = accountOrderSize(order.maker, order.long, order.short)
  const notional_ = notional(
    delta,
    orderGuaranteePrice && !orderGuaranteePrice.isZero() ? orderGuaranteePrice : transformedPrice,
  )
  position.notional = position.notional.plus(notional_)

  // Update open and close size and notional for average entry/exit calculations
  if (delta.gt(BigInt.zero())) {
    position.openSize = position.openSize.plus(delta)
    position.openNotional = position.openNotional.plus(notional_)
  } else if (delta.lt(BigInt.zero())) {
    position.closeSize = position.closeSize.plus(delta.abs())
    position.closeNotional = position.closeNotional.plus(notional_)
  }

  if (!delta.isZero()) position.trades = position.trades.plus(BigInt.fromI32(1))

  accumulateFulfilledOrder(
    marketAccount,
    oracleVersionTimestamp,
    delta.isZero(),
    order.makerTotal,
    order.guaranteeSolve ? BigInt.zero() : order.longTotal, // If this is a guarantee solve, pass values as solver amounts
    order.guaranteeSolve ? BigInt.zero() : order.shortTotal, // If this is a guarantee solve, pass values as solver amounts
    order.guaranteeSolve ? order.longTotal.plus(order.shortTotal) : BigInt.zero(), // If this is a guarantee solve, pass values as solver amounts
    transformedPrice,
    order.referrer,
    order.liquidation,
    order.guaranteeReferrer,
  )

  order.executionPrice = transformedPrice
  market.latestPrice = transformedPrice

  // Save Entities
  order.save()
  position.save()
  market.save()
  marketOrder.save()
}

// Entity Creation
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

    marketOrderEntity.newMaker = BigInt.zero()
    marketOrderEntity.newLong = BigInt.zero()
    marketOrderEntity.newShort = BigInt.zero()

    const oracleVersionEntity = getOrCreateOracleVersion(subOracleAddress, oracleVersion, false, null, null)
    marketOrderEntity.oracleVersion = oracleVersionEntity.id

    marketOrderEntity.makerTotal = BigInt.zero()
    marketOrderEntity.longTotal = BigInt.zero()
    marketOrderEntity.shortTotal = BigInt.zero()

    marketOrderEntity.save()
  }

  return marketOrderEntity
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
    positionEntity.startVersion = BigInt.zero()
    positionEntity.startCollateral = BigInt.zero()
    positionEntity.startMaker = BigInt.zero()
    positionEntity.startLong = BigInt.zero()
    positionEntity.startShort = BigInt.zero()
    positionEntity.openSize = BigInt.zero()
    positionEntity.openNotional = BigInt.zero()
    positionEntity.openOffset = BigInt.zero()
    positionEntity.closeSize = BigInt.zero()
    positionEntity.closeNotional = BigInt.zero()
    positionEntity.closeOffset = BigInt.zero()
    positionEntity.notional = BigInt.zero()
    positionEntity.netDeposits = BigInt.zero()
    positionEntity.accumulation = loadOrCreateOrderAccumulation(
      Bytes.fromUTF8('position').concat(IdSeparatorBytes).concat(positionId),
    ).id
    positionEntity.trades = BigInt.zero()

    positionEntity.save()
  }

  return positionEntity
}

export function buildOrderId(market: Bytes, account: Bytes, orderId: BigInt): Bytes {
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
  newEntity_guaranteeReferrer: Bytes | null,
): OrderStore {
  const entityId = buildOrderId(market, account, orderId)

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
    orderEntity.guaranteeReferrer = newEntity_guaranteeReferrer ? newEntity_guaranteeReferrer : ZeroAddress
    orderEntity.liquidator = newEntity_liquidator ? newEntity_liquidator : ZeroAddress
    orderEntity.liquidation = newEntity_liquidation

    orderEntity.maker = BigInt.zero()
    orderEntity.long = BigInt.zero()
    orderEntity.short = BigInt.zero()
    orderEntity.collateral = BigInt.zero()

    orderEntity.guaranteeSolve = false

    orderEntity.makerTotal = BigInt.zero()
    orderEntity.longTotal = BigInt.zero()
    orderEntity.shortTotal = BigInt.zero()
    orderEntity.depositTotal = BigInt.zero()
    orderEntity.withdrawalTotal = BigInt.zero()

    orderEntity.startCollateral = newEntity_startCollateral
    orderEntity.endCollateral = BigInt.zero()
    orderEntity.newMaker = BigInt.zero()
    orderEntity.newLong = BigInt.zero()
    orderEntity.newShort = BigInt.zero()

    // If we are creating an oracle version here, it is unrequested because the request comes before the OrderCreated event
    const oracleVersionEntity = getOrCreateOracleVersion(subOracleAddress, oracleVersion, false, null, null)
    orderEntity.oracleVersion = oracleVersionEntity.id
    orderEntity.timestamp = oracleVersionEntity.timestamp
    orderEntity.executionPrice = BigInt.zero()

    orderEntity.accumulation = loadOrCreateOrderAccumulation(
      Bytes.fromUTF8('order').concat(IdSeparatorBytes).concat(entityId),
    ).id

    orderEntity.transactionHashes = []

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
  if (orderEntity.guaranteeReferrer.equals(ZeroAddress) && newEntity_guaranteeReferrer) {
    updated = true
    orderEntity.guaranteeReferrer = newEntity_guaranteeReferrer
  }

  if (updated) orderEntity.save()

  return orderEntity
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
  // Load the market entity
  const marketEntity = loadMarket(market)

  // FromID holds the current value for the accumulator
  const fromId = buildMarketAccumulatorId(market, marketEntity.latestVersion)
  const toId = buildMarketAccumulatorId(market, toVersion)
  let fromAccumulator = MarketAccumulatorStore.load(fromId)
  if (!fromAccumulator && marketEntity.latestVersion.equals(BigInt.zero())) {
    fromAccumulator = new MarketAccumulatorStore(fromId)
    fromAccumulator.market = market
    fromAccumulator.fromVersion = BigInt.zero()
    fromAccumulator.toVersion = BigInt.zero()
    fromAccumulator.maker = BigInt.zero()
    fromAccumulator.long = BigInt.zero()
    fromAccumulator.short = BigInt.zero()
    fromAccumulator.latestPrice = BigInt.zero()
    fromAccumulator.pnlMaker = BigInt.zero()
    fromAccumulator.pnlLong = BigInt.zero()
    fromAccumulator.pnlShort = BigInt.zero()
    fromAccumulator.fundingMaker = BigInt.zero()
    fromAccumulator.fundingLong = BigInt.zero()
    fromAccumulator.fundingShort = BigInt.zero()
    fromAccumulator.interestMaker = BigInt.zero()
    fromAccumulator.interestLong = BigInt.zero()
    fromAccumulator.interestShort = BigInt.zero()
    fromAccumulator.positionFeeMaker = BigInt.zero()
    fromAccumulator.exposureMaker = BigInt.zero()
    fromAccumulator.transactionHash = Bytes.empty()

    fromAccumulator.save()
  }

  let entity = MarketAccumulatorStore.load(toId)
  if (!entity) {
    entity = new MarketAccumulatorStore(toId)
  }

  entity.market = market
  entity.fromVersion = marketEntity.latestVersion
  entity.toVersion = toVersion
  entity.maker = marketEntity.maker
  entity.long = marketEntity.long
  entity.short = marketEntity.short
  entity.latestPrice = marketEntity.latestPrice

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

// Accumulations
function accumulateMarket(
  market: Bytes,
  toVersion: BigInt,
  positionFeeMarket: BigInt,
  fundingMarket: BigInt,
  interestMarket: BigInt,
  exposureMarket: BigInt,
): void {
  const marketAddress = Address.fromBytes(market)
  const toAccumulator = loadMarketAccumulator(buildMarketAccumulatorId(marketAddress, toVersion))
  const fromAccumulator = loadMarketAccumulator(buildMarketAccumulatorId(marketAddress, toAccumulator.fromVersion))

  for (let i = 0; i < Buckets.length; i++) {
    const bucketTimestamp = timestampToBucket(toAccumulator.fromVersion, Buckets[i])
    const marketAccumulation = loadOrCreateMarketAccumulation(market, Buckets[i], bucketTimestamp)
    const protocolAccumulation = loadOrCreateProtocolAccumulation(Buckets[i], bucketTimestamp)

    // Per-Side PNLs
    marketAccumulation.pnlMaker = marketAccumulation.pnlMaker.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.maker, 'maker', 'pnl'),
    )
    marketAccumulation.pnlLong = marketAccumulation.pnlLong.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.long, 'long', 'pnl'),
    )
    marketAccumulation.pnlShort = marketAccumulation.pnlShort.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.short, 'short', 'pnl'),
    )
    marketAccumulation.fundingMaker = marketAccumulation.fundingMaker.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.maker, 'maker', 'funding'),
    )
    marketAccumulation.fundingLong = marketAccumulation.fundingLong.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.long, 'long', 'funding'),
    )
    marketAccumulation.fundingShort = marketAccumulation.fundingShort.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.short, 'short', 'funding'),
    )
    marketAccumulation.interestMaker = marketAccumulation.interestMaker.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.maker, 'maker', 'interest'),
    )
    marketAccumulation.interestLong = marketAccumulation.interestLong.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.long, 'long', 'interest'),
    )
    marketAccumulation.interestShort = marketAccumulation.interestShort.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.short, 'short', 'interest'),
    )
    marketAccumulation.positionFeeMaker = marketAccumulation.positionFeeMaker.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.maker, 'maker', 'positionFee'),
    )
    marketAccumulation.exposureMaker = marketAccumulation.exposureMaker.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.maker, 'maker', 'exposure'),
    )
    // Add the market fees to the market accumulation
    marketAccumulation.positionFeeMarket = marketAccumulation.positionFeeMarket.plus(positionFeeMarket)
    marketAccumulation.fundingMarket = marketAccumulation.fundingMarket.plus(fundingMarket)
    marketAccumulation.interestMarket = marketAccumulation.interestMarket.plus(interestMarket)
    marketAccumulation.exposureMarket = marketAccumulation.exposureMarket.plus(exposureMarket)

    // Per-Side PNLs
    protocolAccumulation.pnlMaker = protocolAccumulation.pnlMaker.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.maker, 'maker', 'pnl'),
    )
    protocolAccumulation.pnlLong = protocolAccumulation.pnlLong.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.long, 'long', 'pnl'),
    )
    protocolAccumulation.pnlShort = protocolAccumulation.pnlShort.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.short, 'short', 'pnl'),
    )
    protocolAccumulation.fundingMaker = protocolAccumulation.fundingMaker.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.maker, 'maker', 'funding'),
    )
    protocolAccumulation.fundingLong = protocolAccumulation.fundingLong.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.long, 'long', 'funding'),
    )
    protocolAccumulation.fundingShort = protocolAccumulation.fundingShort.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.short, 'short', 'funding'),
    )
    protocolAccumulation.interestMaker = protocolAccumulation.interestMaker.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.maker, 'maker', 'interest'),
    )
    protocolAccumulation.interestLong = protocolAccumulation.interestLong.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.long, 'long', 'interest'),
    )
    protocolAccumulation.interestShort = protocolAccumulation.interestShort.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.short, 'short', 'interest'),
    )
    protocolAccumulation.positionFeeMaker = protocolAccumulation.positionFeeMaker.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.maker, 'maker', 'positionFee'),
    )
    protocolAccumulation.exposureMaker = protocolAccumulation.exposureMaker.plus(
      accumulatorAccumulated(toAccumulator, fromAccumulator, toAccumulator.maker, 'maker', 'exposure'),
    )
    // Add the market fees to the protocol accumulation
    protocolAccumulation.positionFeeMarket = protocolAccumulation.positionFeeMarket.plus(positionFeeMarket)
    protocolAccumulation.fundingMarket = protocolAccumulation.fundingMarket.plus(fundingMarket)
    protocolAccumulation.interestMarket = protocolAccumulation.interestMarket.plus(interestMarket)
    protocolAccumulation.exposureMarket = protocolAccumulation.exposureMarket.plus(exposureMarket)

    // Record the latest Funding and Interest Rate as value in the bucket
    // The rate is the annualized per position value divided by the (price * time elapsed)
    const elapsed = toVersion.minus(toAccumulator.fromVersion)
    const denominator = toAccumulator.latestPrice.times(elapsed)
    if (!denominator.isZero()) {
      marketAccumulation.fundingRateMaker = div(
        toAccumulator.fundingMaker.minus(fromAccumulator.fundingMaker).times(SecondsPerYear),
        denominator,
      )
      marketAccumulation.fundingRateLong = div(
        toAccumulator.fundingLong.minus(fromAccumulator.fundingLong).times(SecondsPerYear),
        denominator,
      )
      marketAccumulation.fundingRateShort = div(
        toAccumulator.fundingShort.minus(fromAccumulator.fundingShort).times(SecondsPerYear),
        denominator,
      )
      marketAccumulation.interestRateMaker = div(
        toAccumulator.interestMaker.minus(fromAccumulator.interestMaker).times(SecondsPerYear),
        denominator,
      )
      marketAccumulation.interestRateLong = div(
        toAccumulator.interestLong.minus(fromAccumulator.interestLong).times(SecondsPerYear),
        denominator,
      )
      marketAccumulation.interestRateShort = div(
        toAccumulator.interestShort.minus(fromAccumulator.interestShort).times(SecondsPerYear),
        denominator,
      )
    }
    marketAccumulation.save()
    protocolAccumulation.save()
  }
}

function accumulateMarketAccount(
  marketAccount: MarketAccountStore,
  timestamp: BigInt,
  orderAccumulation: OrderAccumulationStore,
  orderReferrer: Bytes,
  guaranteeReferrer: Bytes,
  isTaker: bool,
): void {
  for (let i = 0; i < Buckets.length; i++) {
    const bucketTimestamp = timestampToBucket(timestamp, Buckets[i])
    const marketAccountAccumulation = loadOrCreateMarketAccountAccumulation(marketAccount, Buckets[i], bucketTimestamp)
    const accountAccumulation = loadOrCreateAccountAccumulation(marketAccount.account, Buckets[i], bucketTimestamp)
    const orderReferrerAccumulation = loadOrCreateMarketAccountAccumulation(
      loadOrCreateMarketAccount(Address.fromBytes(marketAccount.market), Address.fromBytes(orderReferrer)),
      Buckets[i],
      bucketTimestamp,
    )
    const guaranteeReferrerAccumulation = loadOrCreateMarketAccountAccumulation(
      loadOrCreateMarketAccount(Address.fromBytes(marketAccount.market), Address.fromBytes(guaranteeReferrer)),
      Buckets[i],
      bucketTimestamp,
    )

    updateSummedOrderAccumulation(marketAccountAccumulation.accumulation, orderAccumulation)
    updateSummedOrderAccumulation(accountAccumulation.accumulation, orderAccumulation)
    if (isTaker) {
      updateSummedOrderAccumulation(marketAccountAccumulation.takerAccumulation, orderAccumulation)
      updateSummedOrderAccumulation(accountAccumulation.takerAccumulation, orderAccumulation)
    }

    // Update referred fees by taking the delta between the updated and saved order accumulations
    const savedOrderAccumulation = loadOrderAccumulation(orderAccumulation.id)
    orderReferrerAccumulation.referredSubtractiveFees = orderReferrerAccumulation.referredSubtractiveFees
      .plus(orderAccumulation.metadata_subtractiveFee)
      .minus(savedOrderAccumulation.metadata_subtractiveFee)
    guaranteeReferrerAccumulation.guaranteeReferredSubtractiveFees =
      guaranteeReferrerAccumulation.guaranteeReferredSubtractiveFees
        .plus(orderAccumulation.metadata_solverFee)
        .minus(savedOrderAccumulation.metadata_solverFee)

    orderReferrerAccumulation.save()
    guaranteeReferrerAccumulation.save()
  }
}

function accumulateFulfilledOrder(
  marketAccount: MarketAccountStore,
  oracleVersionTimestamp: BigInt,
  isDeltaNeutral: bool,
  makerTotal: BigInt,
  longTotal: BigInt,
  shortTotal: BigInt,
  solverTotal: BigInt,
  price: BigInt,
  orderReferrer: Bytes,
  isLiquidation: bool,
  guaranteeReferrer: Bytes,
): void {
  for (let i = 0; i < Buckets.length; i++) {
    const bucketTimestamp = timestampToBucket(oracleVersionTimestamp, Buckets[i])

    // Accumulate at MarketAccount
    const marketAccountAccumulation = loadOrCreateMarketAccountAccumulation(marketAccount, Buckets[i], bucketTimestamp)
    const accountAccumulation = loadOrCreateAccountAccumulation(marketAccount.account, Buckets[i], bucketTimestamp)
    const referrerAccumulation = loadOrCreateMarketAccountAccumulation(
      loadOrCreateMarketAccount(Address.fromBytes(marketAccount.market), Address.fromBytes(orderReferrer)),
      Buckets[i],
      bucketTimestamp,
    )
    const guaranteeReferrerAccumulation = loadOrCreateMarketAccountAccumulation(
      loadOrCreateMarketAccount(Address.fromBytes(marketAccount.market), Address.fromBytes(guaranteeReferrer)),
      Buckets[i],
      bucketTimestamp,
    )
    const marketAccumulation = loadOrCreateMarketAccumulation(marketAccount.market, Buckets[i], bucketTimestamp)
    const protocolAccumulation = loadOrCreateProtocolAccumulation(Buckets[i], bucketTimestamp)

    const makerNotional = notional(makerTotal, price)
    const longNotional = notional(longTotal, price)
    const shortNotional = notional(shortTotal, price)
    const solverNotional = notional(solverTotal, price)

    // Record unit volumes
    marketAccountAccumulation.maker = marketAccountAccumulation.maker.plus(makerTotal)
    marketAccountAccumulation.long = marketAccountAccumulation.long.plus(longTotal)
    marketAccountAccumulation.short = marketAccountAccumulation.short.plus(shortTotal)
    marketAccountAccumulation.taker = marketAccountAccumulation.taker.plus(longTotal).plus(shortTotal)
    marketAccountAccumulation.solver = marketAccountAccumulation.solver.plus(solverTotal)

    marketAccumulation.maker = marketAccumulation.maker.plus(makerTotal)
    marketAccumulation.long = marketAccumulation.long.plus(longTotal)
    marketAccumulation.short = marketAccumulation.short.plus(shortTotal)
    marketAccumulation.taker = marketAccumulation.taker.plus(longTotal).plus(shortTotal)
    marketAccumulation.solver = marketAccumulation.solver.plus(solverTotal)

    // Record notional volumes
    marketAccountAccumulation.makerNotional = marketAccountAccumulation.makerNotional.plus(makerNotional)
    marketAccountAccumulation.longNotional = marketAccountAccumulation.longNotional.plus(longNotional)
    marketAccountAccumulation.shortNotional = marketAccountAccumulation.shortNotional.plus(shortNotional)
    marketAccountAccumulation.takerNotional = marketAccountAccumulation.takerNotional
      .plus(longNotional)
      .plus(shortNotional)
    marketAccountAccumulation.solverNotional = marketAccountAccumulation.solverNotional.plus(solverNotional)

    marketAccumulation.makerNotional = marketAccumulation.makerNotional.plus(makerNotional)
    marketAccumulation.longNotional = marketAccumulation.longNotional.plus(longNotional)
    marketAccumulation.shortNotional = marketAccumulation.shortNotional.plus(shortNotional)
    marketAccumulation.takerNotional = marketAccumulation.takerNotional.plus(longNotional).plus(shortNotional)
    marketAccumulation.solverNotional = marketAccumulation.solverNotional.plus(solverNotional)

    protocolAccumulation.makerNotional = protocolAccumulation.makerNotional.plus(makerNotional)
    protocolAccumulation.longNotional = protocolAccumulation.longNotional.plus(longNotional)
    protocolAccumulation.shortNotional = protocolAccumulation.shortNotional.plus(shortNotional)
    protocolAccumulation.takerNotional = protocolAccumulation.takerNotional.plus(longNotional).plus(shortNotional)
    protocolAccumulation.solverNotional = protocolAccumulation.solverNotional.plus(solverNotional)

    accountAccumulation.makerNotional = accountAccumulation.makerNotional.plus(makerNotional)
    accountAccumulation.longNotional = accountAccumulation.longNotional.plus(longNotional)
    accountAccumulation.shortNotional = accountAccumulation.shortNotional.plus(shortNotional)
    accountAccumulation.takerNotional = accountAccumulation.takerNotional.plus(longNotional).plus(shortNotional)
    accountAccumulation.solverNotional = accountAccumulation.solverNotional.plus(solverNotional)

    // Record referred values
    referrerAccumulation.referredMakerNotional = referrerAccumulation.referredMakerNotional.plus(makerNotional)
    referrerAccumulation.referredLongNotional = referrerAccumulation.referredLongNotional.plus(longNotional)
    referrerAccumulation.referredShortNotional = referrerAccumulation.referredShortNotional.plus(shortNotional)
    guaranteeReferrerAccumulation.guaranteeReferredLongNotional =
      guaranteeReferrerAccumulation.guaranteeReferredLongNotional.plus(longNotional)
    guaranteeReferrerAccumulation.guaranteeReferredShortNotional =
      guaranteeReferrerAccumulation.guaranteeReferredShortNotional.plus(shortNotional)

    if (!isDeltaNeutral) {
      marketAccountAccumulation.trades = marketAccountAccumulation.trades.plus(BigInt.fromU32(1))
      accountAccumulation.trades = accountAccumulation.trades.plus(BigInt.fromU32(1))
      referrerAccumulation.referredTrades = referrerAccumulation.referredTrades.plus(BigInt.fromU32(1))
      guaranteeReferrerAccumulation.guaranteeReferredTrades =
        guaranteeReferrerAccumulation.guaranteeReferredTrades.plus(BigInt.fromU32(1))
      marketAccumulation.trades = marketAccumulation.trades.plus(BigInt.fromU32(1))
      protocolAccumulation.trades = protocolAccumulation.trades.plus(BigInt.fromU32(1))

      // If this is the MarketAccount's first trade for the bucket, increment the number of traders
      if (marketAccountAccumulation.trades.equals(BigInt.fromU32(1))) {
        marketAccumulation.traders = marketAccumulation.traders.plus(BigInt.fromU32(1))
        protocolAccumulation.traders = protocolAccumulation.traders.plus(BigInt.fromU32(1))
        referrerAccumulation.referredTraders = referrerAccumulation.referredTraders.plus(BigInt.fromU32(1))
        guaranteeReferrerAccumulation.guaranteeReferredTraders =
          guaranteeReferrerAccumulation.guaranteeReferredTraders.plus(BigInt.fromU32(1))
      }
    }

    if (isLiquidation) {
      marketAccountAccumulation.liquidations = marketAccountAccumulation.liquidations.plus(BigInt.fromU32(1))
      accountAccumulation.liquidations = accountAccumulation.liquidations.plus(BigInt.fromU32(1))
    }

    accountAccumulation.save()
    marketAccountAccumulation.save()
    referrerAccumulation.save()
    guaranteeReferrerAccumulation.save()
    marketAccumulation.save()
    protocolAccumulation.save()
  }
}

// Updates a Bucket's or Position's OrderAccumulation based on an underlying order accumulation
// NOTE: Assumes the `updatedOrderAccumulation` has not been saved, allowing a diff between the saved and updated version
function updateSummedOrderAccumulation(accumulationId: Bytes, updatedOrderAccumulation: OrderAccumulationStore): void {
  const savedOrderAccumulation = loadOrderAccumulation(updatedOrderAccumulation.id)
  const accumulationEntity = loadOrderAccumulation(accumulationId)

  accumulationEntity.collateral_accumulation = accumulationEntity.collateral_accumulation
    .plus(updatedOrderAccumulation.collateral_accumulation)
    .minus(savedOrderAccumulation.collateral_accumulation)
  accumulationEntity.fee_accumulation = accumulationEntity.fee_accumulation
    .plus(updatedOrderAccumulation.fee_accumulation)
    .minus(savedOrderAccumulation.fee_accumulation)

  accumulationEntity.collateral_subAccumulation_offset = accumulationEntity.collateral_subAccumulation_offset
    .plus(updatedOrderAccumulation.collateral_subAccumulation_offset)
    .minus(savedOrderAccumulation.collateral_subAccumulation_offset)
  accumulationEntity.collateral_subAccumulation_priceOverride =
    accumulationEntity.collateral_subAccumulation_priceOverride
      .plus(updatedOrderAccumulation.collateral_subAccumulation_priceOverride)
      .minus(savedOrderAccumulation.collateral_subAccumulation_priceOverride)
  accumulationEntity.collateral_subAccumulation_pnl = accumulationEntity.collateral_subAccumulation_pnl
    .plus(updatedOrderAccumulation.collateral_subAccumulation_pnl)
    .minus(savedOrderAccumulation.collateral_subAccumulation_pnl)
  accumulationEntity.collateral_subAccumulation_funding = accumulationEntity.collateral_subAccumulation_funding
    .plus(updatedOrderAccumulation.collateral_subAccumulation_funding)
    .minus(savedOrderAccumulation.collateral_subAccumulation_funding)
  accumulationEntity.collateral_subAccumulation_interest = accumulationEntity.collateral_subAccumulation_interest
    .plus(updatedOrderAccumulation.collateral_subAccumulation_interest)
    .minus(savedOrderAccumulation.collateral_subAccumulation_interest)
  accumulationEntity.collateral_subAccumulation_makerPositionFee =
    accumulationEntity.collateral_subAccumulation_makerPositionFee
      .plus(updatedOrderAccumulation.collateral_subAccumulation_makerPositionFee)
      .minus(savedOrderAccumulation.collateral_subAccumulation_makerPositionFee)
  accumulationEntity.collateral_subAccumulation_makerExposure =
    accumulationEntity.collateral_subAccumulation_makerExposure
      .plus(updatedOrderAccumulation.collateral_subAccumulation_makerExposure)
      .minus(savedOrderAccumulation.collateral_subAccumulation_makerExposure)

  accumulationEntity.fee_subAccumulation_settlement = accumulationEntity.fee_subAccumulation_settlement
    .plus(updatedOrderAccumulation.fee_subAccumulation_settlement)
    .minus(savedOrderAccumulation.fee_subAccumulation_settlement)
  accumulationEntity.fee_subAccumulation_trade = accumulationEntity.fee_subAccumulation_trade
    .plus(updatedOrderAccumulation.fee_subAccumulation_trade)
    .minus(savedOrderAccumulation.fee_subAccumulation_trade)
  accumulationEntity.fee_subAccumulation_liquidation = accumulationEntity.fee_subAccumulation_liquidation
    .plus(updatedOrderAccumulation.fee_subAccumulation_liquidation)
    .minus(savedOrderAccumulation.fee_subAccumulation_liquidation)
  accumulationEntity.fee_subAccumulation_additive = accumulationEntity.fee_subAccumulation_additive
    .plus(updatedOrderAccumulation.fee_subAccumulation_additive)
    .minus(savedOrderAccumulation.fee_subAccumulation_additive)
  accumulationEntity.fee_subAccumulation_triggerOrder = accumulationEntity.fee_subAccumulation_triggerOrder
    .plus(updatedOrderAccumulation.fee_subAccumulation_triggerOrder)
    .minus(savedOrderAccumulation.fee_subAccumulation_triggerOrder)

  accumulationEntity.metadata_subtractiveFee = accumulationEntity.metadata_subtractiveFee
    .plus(updatedOrderAccumulation.metadata_subtractiveFee)
    .minus(savedOrderAccumulation.metadata_subtractiveFee)
  accumulationEntity.metadata_solverFee = accumulationEntity.metadata_solverFee
    .plus(updatedOrderAccumulation.metadata_solverFee)
    .minus(savedOrderAccumulation.metadata_solverFee)
  accumulationEntity.metadata_net = accumulationEntity.collateral_accumulation.minus(
    accumulationEntity.fee_accumulation,
  )

  accumulationEntity.save()
}
