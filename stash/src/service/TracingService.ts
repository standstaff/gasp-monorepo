import logger from '../util/Logger.js'
import { transactionRepository } from '../repository/TransactionRepository.js'

interface TraceTransactionRequest {
  txHash: string
  address: string
}

export const startTracingTransaction = async (
  traceRequest: TraceTransactionRequest
): Promise<object> => {
  const { txHash, address } = traceRequest
  const timestamp = new Date().toISOString()
  const status = 'L1_INITIATED'

  const transactionData = {
    requestId: '', //this is requestId we get from L1, empty when we start tracing
    txHash,
    address,
    created: Date.parse(timestamp),
    updated: Date.parse(timestamp),
    status,
  }

  try {
    const existingTransactions = await transactionRepository
      .search()
      .where('address')
      .equals(address)
      .and('txHash')
      .equals(txHash)
      .return.all()

    if (existingTransactions.length > 0) {
      logger.info(
        `Transaction already exists for address: ${address} and txHash: ${txHash}`
      )
      return existingTransactions[0]
    } else {
      const transaction = await transactionRepository.save(transactionData)
      logger.info(
        `Transaction tracing started for address: ${address} and txHash: ${txHash}`
      )
      const symbols = Object.getOwnPropertySymbols(transaction)
      const entityIdSymbol = symbols.find(
        (symbol) => symbol.toString() === 'Symbol(entityId)'
      )
      const value = transaction[entityIdSymbol as any]

      return {
        ...transaction,
        entityId: value,
      }
    }
  } catch (error) {
    logger.error(
      `Error storing or retrieving transaction data: ${error.message}`
    )
    throw error
  }
}

export const getTransactionsByAddress = async (
  address: string
): Promise<object[]> => {
  return await transactionRepository
    .search()
    .where('address')
    .equals(address)
    .return.all()
}

export const getStatusByTxHashOrEntityId = async (
  identifier: string
): Promise<string | null> => {
  const transactions = await transactionRepository
    .search()
    .where('txHash')
    .equals(identifier)
    .return.all()

  if (transactions.length === 0) {
    const transaction = await transactionRepository.fetch(identifier)
    if (transaction) {
      return transaction.status
    }
  }

  if (transactions.length > 0) {
    return transactions[0].status
  }
  return null
}

export const getTransactionByEntityId = async (
  entityId: string
): Promise<object | null> => {
  const transactionsByEntityId = await transactionRepository.fetch(entityId)
  if (transactionsByEntityId) {
    return transactionsByEntityId
  }
  return null
}

export const getTransactionByTxHash = async (
  txHash: string
): Promise<object | null> => {
  const transactionsByTxHash = await transactionRepository
    .search()
    .where('txHash')
    .equals(txHash)
    .return.all()

  if (transactionsByTxHash.length > 0) {
    return transactionsByTxHash[0]
  }
  return null
}

export async function findTransactionsByAddressAndStatus(
  address: string,
  status: string
) {
  const transactions = await transactionRepository
    .search()
    .where('address')
    .equals(address)
    .and('status')
    .equals(status)
    .return.all()
  logger.info(
    `Found ${transactions.length} transactions for address: ${address} and status: ${status}`
  )
  return transactions
}
