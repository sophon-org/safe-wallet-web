import { isEIP712TypedData } from '@/utils/safe-messages'
import { normalizeTypedData } from '@/utils/web3'
import { type SafeTransaction } from '@safe-global/safe-core-sdk-types'
import { generateTypedData } from '@safe-global/protocol-kit/dist/src/utils/eip-712'
import type { EIP712TypedData } from '@safe-global/safe-gateway-typescript-sdk'
import { type SecurityResponse, type SecurityModule, SecuritySeverity } from '../types'
import type { AssetDiff, TransactionScanResponse } from './types'
import { BLOCKAID_API } from '@/config/constants'

/** @see https://docs.blockaid.io/docs/supported-chains */
const API_CHAINS: Record<string, string> = {
  1: 'ethereum',
  56: 'bsc',
  137: 'polygon',
  10: 'optimism',
  42161: 'arbitrum',
  43114: 'avalanche',
  8453: 'base',
  238: 'blast',
  59144: 'linea',
  7777777: 'zora',
}
const blockaidSeverityMap: Record<string, SecuritySeverity> = {
  Malicious: SecuritySeverity.HIGH,
  Warning: SecuritySeverity.MEDIUM,
  Benign: SecuritySeverity.NONE,
  Info: SecuritySeverity.NONE,
}

export type BlockaidModuleRequest = {
  chainId: number
  safeAddress: string
  walletAddress: string
  data: SafeTransaction | EIP712TypedData
  threshold: number
}

export type BlockaidModuleResponse = {
  description?: string
  classification?: string
  reason?: string
  issues: {
    severity: SecuritySeverity
    description: string
  }[]
  balanceChange: AssetDiff[]
  error: Error | undefined
}

type BlockaidPayload = {
  chain: string
  account_address: string
  metadata: {
    domain: string
  }
  data: {
    method: 'eth_signTypedData_v4'
    params: [string, string]
  }
  options: ['simulation', 'validation']
}

export class BlockaidModule implements SecurityModule<BlockaidModuleRequest, BlockaidModuleResponse> {
  static prepareMessage(request: BlockaidModuleRequest): string {
    const { data, safeAddress, chainId } = request
    if (isEIP712TypedData(data)) {
      const normalizedMsg = normalizeTypedData(data)
      return JSON.stringify(normalizedMsg)
    } else {
      return JSON.stringify(
        generateTypedData({
          safeAddress,
          safeVersion: '1.3.0', // TODO: pass to module, taking into account that lower Safe versions don't have chainId in payload
          chainId: BigInt(chainId),
          // TODO: find out why these types are incompaitble
          data: {
            ...data.data,
            safeTxGas: data.data.safeTxGas,
            baseGas: data.data.baseGas,
            gasPrice: data.data.gasPrice,
          },
        }),
      )
    }
  }
  async scanTransaction(request: BlockaidModuleRequest): Promise<SecurityResponse<BlockaidModuleResponse>> {
    if (!BLOCKAID_API) {
      throw new Error('Security check API not configured')
    }

    const { chainId, safeAddress, data } = request

    const message = BlockaidModule.prepareMessage(request)

    const payload: BlockaidPayload = {
      chain: API_CHAINS[chainId],
      account_address: safeAddress,
      data: {
        method: 'eth_signTypedData_v4',
        params: [safeAddress, message],
      },
      options: ['simulation', 'validation'],
      metadata: {
        domain: 'http://localhost:3000',
      },
    }

    const res = await fetch(`${BLOCKAID_API}/v0/evm/json-rpc/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      throw new Error('Blockaid scan failed', await res.json())
    }

    const result = (await res.json()) as TransactionScanResponse

    const issues = (result.validation?.features ?? [])
      .filter((feature) => feature.type === 'Malicious' || feature.type === 'Warning')
      .map((feature) => ({
        severity: blockaidSeverityMap[feature.type],
        description: feature.description,
      }))

    const simulation = result.simulation
    let balanceChange: AssetDiff[] = []
    let error: Error | undefined = undefined
    if (simulation?.status === 'Success') {
      balanceChange = simulation.assets_diffs[safeAddress]
    } else if (simulation?.status === 'Error') {
      error = new Error('Simulation failed')
    }

    return {
      severity: result.validation?.result_type
        ? blockaidSeverityMap[result.validation.result_type]
        : SecuritySeverity.NONE ?? SecuritySeverity.NONE,
      payload: {
        description: result.validation?.description,
        classification: result.validation?.classification,
        reason: result.validation?.reason,
        issues,
        balanceChange,
        error,
      },
    }
  }
}
