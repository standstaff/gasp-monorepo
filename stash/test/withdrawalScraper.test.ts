import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  processWithdrawalEvents,
  startTracingWithdrawal,
  updateWithdrawalsWhenBatchCreated,
} from '../src/scraper/WithdrawalScraper.js'
import { withdrawalRepository } from '../src/repository/TransactionRepository.js'
import { redis } from '../src/connector/RedisConnector.js'
import { ApiPromise } from '@polkadot/api'

// Mock dependencies
vi.mock('../repository/TransactionRepository')
vi.mock('../connector/RedisConnector')
vi.mock('@polkadot/api')
vi.mock('viem')
vi.mock('../util/Logger')

describe('processWithdrawalEvents', () => {
  let mockApi: ApiPromise

  beforeEach(() => {
    const hash = '0x123'
    const proof = '0x00'
    mockApi = {
      rpc: {
        rolldown: {
          get_abi_encoded_l2_request: vi
            .fn()
            .mockResolvedValue({ toHex: () => hash }), //when one withdrawal in a block get_abi_encoded_l2_request.toHex() will return hash
          get_merkle_proof: vi.fn().mockResolvedValue({ toHex: () => proof }), //when one withdrawal in a block get_merkle_proof.toHex() will return 0x00 (hex of empty)
          get_merkle_root: vi.fn().mockResolvedValue({ toHuman: () => [] }), //when one withdrawal in a block get_merkle_root.toHex() will return []
        },
      },
      createType: vi.fn(),
    } as unknown as ApiPromise

    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should process WithdrawalRequestCreated event', async () => {
    const mockBlock = {
      events: [
        [
          0,
          {
            section: 'rolldown',
            method: 'WithdrawalRequestCreated',
            data: {
              requestId: { id: 1 },
              txHash: '0x123',
              address: '0xabc',
              created: expect.any(Number),
              updated: expect.any(Number),
              status: 'L2_INITIATED',
              type: 'withdrawal',
              chain: 'testchain',
              amount: '100',
              asset_chainId: 'testchain',
              asset_address: '0xtoken',
              proof: '',
              calldata: '0xabcdef',
            },
          },
        ],
      ],
    }

    const mockWithdrawalData = {
      requestId: 1,
      txHash: '0x123',
      address: '0xabc',
      created: expect.any(Number),
      updated: expect.any(Number),
      status: 'L2_INITIATED',
      type: 'withdrawal',
      chain: 'testchain',
      amount: '100',
      asset_chainId: 'testchain',
      asset_address: '0xtoken',
      proof: '',
      calldata: '0xabcdef',
    }

    vi.spyOn(redis.client, 'get').mockResolvedValue(
      JSON.stringify([{ key: 'testchain', chainId: 'testchain' }])
    )
    vi.spyOn(withdrawalRepository, 'save').mockResolvedValue(mockWithdrawalData)

    await processWithdrawalEvents(mockApi, mockBlock as any)

    expect(withdrawalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'L2_INITIATED',
        type: 'withdrawal',
      })
    )
  })

  it('should process TxBatchCreated event', async () => {
    const mockBlock = {
      events: [
        [
          0,
          {
            section: 'rolldown',
            method: 'TxBatchCreated',
            data: { range: [1, 5], chain: 'testchain' },
          },
        ],
      ],
    }

    const mockExistingWithdrawals = [
      { requestId: 2, chain: 'testchain', status: 'L2_INITIATED' },
      { requestId: 4, chain: 'testchain', status: 'L2_INITIATED' },
    ]

    vi.spyOn(withdrawalRepository, 'search').mockReturnValue({
      where: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      and: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      returnAll: vi.fn().mockResolvedValue(mockExistingWithdrawals),
    } as any)

    await processWithdrawalEvents(mockApi, mockBlock as any)

    expect(withdrawalRepository.save).toHaveBeenCalledTimes(2)
    expect(withdrawalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'L2_CONFIRMED',
        proof: expect.any(String),
      })
    )
  })
})

describe('startTracingWithdrawal', () => {
  let mockApi: ApiPromise

  beforeEach(() => {
    mockApi = {
      rpc: {
        rolldown: {
          get_abi_encoded_l2_request: vi
            .fn()
            .mockResolvedValue({ toHex: () => '0xabcdef' }),
        },
      },
    } as unknown as ApiPromise

    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should start tracing a withdrawal successfully', async () => {
    const mockEventData = {
      chain: 'testchain',
      requestId: { id: '1' },
      hash_: '0x123',
      recipient: '0xabc',
      amount: '100',
      tokenAddress: '0xtoken',
      ferryTip: 1,
    }

    vi.spyOn(redis.client, 'get').mockResolvedValue(
      JSON.stringify([{ key: 'testchain', chainId: 'testchain' }])
    )

    vi.spyOn(withdrawalRepository, 'save').mockResolvedValue({
      status: 'L2_INITIATED',
      proof: '0xproof',
      address: '0xabc',
      amount: '100',
      asset_address: '0xtoken',
      asset_chainId: 'testchain',
      calldata: '0xabcdef',
      chain: 'testchain',
      created: 1729517393690,
      requestId: 1,
      txHash: '0x123',
      type: 'withdrawal',
      updated: 1729517393690,
    })

    const result = await startTracingWithdrawal(mockApi, mockEventData)

    expect(result).toEqual(
      expect.objectContaining({
        requestId: 1,
        txHash: '0x123',
        address: '0xabc',
        created: 1729517393690,
        updated: 1729517393690,
        status: 'L2_INITIATED',
        type: 'withdrawal',
        chain: 'testchain',
        amount: '100',
        asset_chainId: 'testchain',
        asset_address: '0xtoken',
        proof: '0xproof',
        calldata: '0xabcdef',
      })
    )
    expect(withdrawalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'L2_INITIATED',
        type: 'withdrawal',
      })
    )
  })

  it('should handle unknown chain', async () => {
    const mockEventData = {
      chain: 'unknownchain',
      requestId: { id: '1' },
      hash_: '0x123',
      recipient: '0xabc',
      amount: '100',
      tokenAddress: '0xtoken',
    }

    vi.spyOn(redis.client, 'get').mockResolvedValue(null)
    vi.spyOn(withdrawalRepository, 'save').mockResolvedValue({
      ...mockEventData,
      status: 'L2_INITIATED',
      asset_chainId: 'unknown',
    })

    const result = await startTracingWithdrawal(mockApi, mockEventData)

    expect(result.asset_chainId).toBe('unknown')
  })
})

describe('updateWithdrawalsWhenBatchCreated', () => {
  let mockApi: ApiPromise

  beforeEach(() => {
    mockApi = {
      rpc: {
        rolldown: {
          get_merkle_proof: vi
            .fn()
            .mockResolvedValue({ toHex: () => '0xproof' }),
          get_merkle_root: vi
            .fn()
            .mockResolvedValue({ toHuman: () => '0xroot' }),
        },
      },
      createType: vi.fn().mockReturnValue('mockChain'),
    } as unknown as ApiPromise

    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should update withdrawals when batch is created', async () => {
    const mockEventData = {
      range: [1, 5],
      chain: 'testchain',
    }

    const mockExistingWithdrawals = [
      { requestId: 2, chain: 'testchain', status: 'L2_INITIATED' },
      { requestId: 4, chain: 'testchain', status: 'L2_INITIATED' },
    ]

    vi.spyOn(withdrawalRepository, 'search').mockReturnValue({
      where: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      and: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      returnAll: vi.fn().mockResolvedValue(mockExistingWithdrawals),
    } as any)

    vi.spyOn(withdrawalRepository, 'save').mockResolvedValue({
      status: 'L2_CONFIRMED',
      proof: '0xproof',
    })

    await updateWithdrawalsWhenBatchCreated(mockApi, mockEventData)

    expect(withdrawalRepository.save).toHaveBeenCalledTimes(2)
    expect(withdrawalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'L2_CONFIRMED',
        proof: '0xproof',
      })
    )
  })

  it('should handle case when no matching withdrawals are found', async () => {
    const mockEventData = {
      range: [1, 5],
      chain: 'testchain',
    }

    vi.spyOn(withdrawalRepository, 'search').mockReturnValue({
      where: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      and: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      returnAll: vi.fn().mockResolvedValue([]),
    } as any)

    await updateWithdrawalsWhenBatchCreated(mockApi, mockEventData)

    expect(withdrawalRepository.save).not.toHaveBeenCalled()
  })
})