// Handles Out of Band Fees that are processed by looking at the Transaction Receipt

import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { fromBig18 } from './big6Math'

// event InterfaceFeeCharged(address indexed account, IMarket indexed market, InterfaceFee fee);
const MultiInvokerInterfaceFeeChargedTopic0 = Bytes.fromHexString(
  '0x7bdf48e07cd0f3669b6ef1a2004307c0c28e2c22d70ae7a6d8e1ea1b42690591',
)

// event InterfaceFeeCharged(address indexed,address indexed ,(uint256,address))
const MultiInvokerInterfaceFeeChargedTopic0_v2_3 = Bytes.fromHexString(
  '0x037af8589fe92360e800c649b0515b0b2bf77b577766ff952b17630c4ad25f47',
)

// event TriggerOrderInterfaceFeeCharged(address indexed,address indexed,(uint256,address,bool,bool))
const ManagerInterfaceFeeChargedTopic0 = Bytes.fromHexString(
  '0x53287d6489871e2ad186467efe70bdd15afbbd29f769f1e1c639b4d5a5d654ed',
)

// event KeeperCall(address indexed sender, uint256 gasUsed, UFixed18 multiplier, uint256 buffer, UFixed18 keeperFee)
const KeptKeeperCallTopic0_v2_0_0 = Bytes.fromHexString(
  '0xd7848cca80f0c7619e9c50ea855dd15779e356a791d0630001913eab6f7eaef7',
)

// event KeeperCall(address indexed sender, uint256 applicableGas, uint256 applicableValue, UFixed18 baseFee, UFixed18 calldataFee, UFixed18 keeperFee)
const KeptKeeperCallTopic0_v2_1_0 = Bytes.fromHexString(
  '0xfa0333956d06e335c550bd5fc4ac9c003c6545e371331b1071fa4d5d8519d6c1',
)

export function processReceiptForFees(
  receipt: ethereum.TransactionReceipt | null,
  collateral: BigInt,
  sizeDelta: BigInt,
): BigInt[] {
  let interfaceFee = BigInt.zero()
  let orderFee = BigInt.zero()

  // These fees can only be charged on negative collateral deltas and 0 size deltas
  if (receipt == null) return [interfaceFee, orderFee]
  if (collateral.ge(BigInt.zero())) return [interfaceFee, orderFee]
  if (!sizeDelta.isZero()) return [interfaceFee, orderFee]

  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i]
    if (log.topics[0].equals(MultiInvokerInterfaceFeeChargedTopic0)) {
      const decoded = ethereum.decode('(uint256,address,bool)', log.data)
      if (decoded) {
        const feeAmount = decoded.toTuple()[0].toBigInt()
        // If the fee is equal to the collateral withdrawal, then it is an interface fee
        if (feeAmount.equals(collateral.neg())) {
          interfaceFee = interfaceFee.plus(feeAmount)
        }
      }
    }

    if (log.topics[0].equals(MultiInvokerInterfaceFeeChargedTopic0_v2_3)) {
      const decoded = ethereum.decode('(uint256,address)', log.data)
      if (decoded) {
        const feeAmount = decoded.toTuple()[0].toBigInt()
        // If the fee is equal to the collateral withdrawal, then it is an interface fee
        if (feeAmount.equals(collateral.neg())) {
          interfaceFee = interfaceFee.plus(feeAmount)
        }
      }
    }

    if (log.topics[0].equals(ManagerInterfaceFeeChargedTopic0)) {
      const decoded = ethereum.decode('(uint256,address,bool,bool)', log.data)
      if (decoded) {
        const feeAmount = decoded.toTuple()[0].toBigInt()
        // If the fee is equal to the collateral withdrawal, then it is an interface fee
        if (feeAmount.equals(collateral.neg())) {
          interfaceFee = interfaceFee.plus(feeAmount)
        }
      }
    }

    if (log.topics[0].equals(KeptKeeperCallTopic0_v2_0_0)) {
      const decoded = ethereum.decode('(uint256,uint256,uint256,uint256)', log.data)
      if (decoded) {
        const feeAmount = fromBig18(decoded.toTuple()[3].toBigInt(), true)
        // If the fee is equal to the collateral withdrawal, then it is an order fee
        if (feeAmount.equals(collateral.neg())) {
          orderFee = feeAmount
        }
      }
    }

    if (log.topics[0].equals(KeptKeeperCallTopic0_v2_1_0)) {
      const decoded = ethereum.decode('(uint256,uint256,uint256,uint256,uint256)', log.data)
      if (decoded) {
        const feeAmount = fromBig18(decoded.toTuple()[4].toBigInt(), true)
        // If the fee is equal to the collateral withdrawal, then it is an order fee
        if (feeAmount.equals(collateral.neg())) {
          orderFee = feeAmount
        }
      }
    }
  }

  return [interfaceFee, orderFee]
}
