import { Address, BigInt, dataSource } from '@graphprotocol/graph-ts'
import { AccountDeployed as AccountDeployedEvent } from '../generated/Controller/Controller'
import { ERC20 } from '../generated/Controller/ERC20'
import { Transfer as TransferEvent } from '../generated/USDC/ERC20'
import {
  CollateralAccount as CollateralAccountStore,
  CollateralAccountTransfer as CollateralAccountTransferStore,
  Market as MarketStore,
} from '../generated/schema'
import { loadOrCreateAccount } from './util/loadOrCreate'
import { IdSeparatorBytes } from './util/constants'
import { bigIntToBytes } from './util'
import { fromBig18 } from './util/big6Math'

export function handleAccountDeployed(event: AccountDeployedEvent): void {
  const collateralAccount = new CollateralAccountStore(event.params.account)
  const account = loadOrCreateAccount(event.params.owner)

  collateralAccount.account = event.params.owner

  // Check for initial USDC balance
  const initialBalance = ERC20.bind(Address.fromBytes(dataSource.context().getBytes('usdc'))).balanceOf(
    event.params.account,
  )
  collateralAccount.initialBalance = initialBalance
  collateralAccount.balance = initialBalance

  collateralAccount.transactionHash = event.transaction.hash
  collateralAccount.blockNumber = event.block.number
  collateralAccount.blockTimestamp = event.block.timestamp

  collateralAccount.save()

  account.collateralAccount = collateralAccount.id
  account.save()
}

export function handleTransferUSDC(event: TransferEvent): void {
  const reserveAddress = Address.fromBytes(dataSource.context().getBytes('reserve'))
  if (event.params.value.isZero()) return
  if (event.params.from.equals(reserveAddress) || event.params.to.equals(reserveAddress)) return

  const fromCollateralAccount = CollateralAccountStore.load(event.params.from)
  if (fromCollateralAccount !== null) {
    fromCollateralAccount.balance = fromCollateralAccount.balance.minus(event.params.value)

    createTransferEntity(event, fromCollateralAccount, 'withdrawal', false)
    fromCollateralAccount.save()
  }

  const toCollateralAccount = CollateralAccountStore.load(event.params.to)
  if (toCollateralAccount !== null) {
    toCollateralAccount.balance = toCollateralAccount.balance.plus(event.params.value)

    createTransferEntity(event, toCollateralAccount, 'deposit', false)
    toCollateralAccount.save()
  }
}

export function handleTransferDSU(event: TransferEvent): void {
  const reserveAddress = Address.fromBytes(dataSource.context().getBytes('reserve'))
  if (event.params.value.isZero()) return
  if (event.params.from.equals(reserveAddress) || event.params.to.equals(reserveAddress)) return

  const fromMarket = MarketStore.load(event.params.from)
  const toMarket = MarketStore.load(event.params.to)

  const fromCollateralAccount = CollateralAccountStore.load(event.params.from)
  if (fromCollateralAccount !== null) {
    fromCollateralAccount.balance = fromCollateralAccount.balance.minus(fromBig18(event.params.value, true))

    createTransferEntity(event, fromCollateralAccount, toMarket !== null ? 'marketDeposit' : 'withdrawal', true)
    fromCollateralAccount.save()
  }

  const toCollateralAccount = CollateralAccountStore.load(event.params.to)
  if (toCollateralAccount !== null) {
    toCollateralAccount.balance = toCollateralAccount.balance.plus(fromBig18(event.params.value, false))

    createTransferEntity(event, toCollateralAccount, fromMarket !== null ? 'marketWithdrawal' : 'deposit', true)
    toCollateralAccount.save()
  }
}

function createTransferEntity(
  event: TransferEvent,
  collateralAccount: CollateralAccountStore,
  direction: string,
  isDSU: boolean,
): void {
  const transfer = new CollateralAccountTransferStore(
    collateralAccount.id
      .concat(IdSeparatorBytes)
      .concat(event.transaction.hash)
      .concat(IdSeparatorBytes)
      .concat(bigIntToBytes(event.logIndex)),
  )

  transfer.collateralAccount = collateralAccount.id
  transfer.value = isDSU
    ? fromBig18(event.params.value, event.params.from.equals(Address.fromBytes(collateralAccount.id)))
    : event.params.value
  transfer.direction = direction
  transfer.from = event.params.from
  transfer.to = event.params.to
  transfer.transactionHash = event.transaction.hash
  transfer.blockNumber = event.block.number
  transfer.blockTimestamp = event.block.timestamp
  transfer.save()
}
