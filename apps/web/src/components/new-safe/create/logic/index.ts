import type { SafeVersion, TransactionOptions } from '@safe-global/types-kit'
import { BrowserProvider as ZKBrowserProvider, Provider as ZKProvider, Signer, utils } from 'zksync-ethers'
import { type TransactionResponse, type Eip1193Provider, type Provider, type BrowserProvider } from 'ethers'
import semverSatisfies from 'semver/functions/satisfies'
import { type SafeState, cgwApi as safesApi } from '@safe-global/store/gateway/AUTO_GENERATED/safes'
import { cgwApi as relayApi } from '@safe-global/store/gateway/AUTO_GENERATED/relay'
import { type Chain } from '@safe-global/store/gateway/AUTO_GENERATED/chains'
import { getStoreInstance } from '@/store'
import { getReadOnlyProxyFactoryContract } from '@/services/contracts/safeContracts'
import type { UrlObject } from 'url'
import { AppRoutes } from '@/config/routes'
import { SAFE_APPS_EVENTS, trackEvent } from '@/services/analytics'
import Safe, { predictSafeAddress, SafeProvider } from '@safe-global/protocol-kit'
import type { ContractNetworkConfig, PredictedSafeProps } from '@safe-global/protocol-kit'
import type { ConnectedWallet } from '@/hooks/wallets/useOnboard'

import { backOff } from 'exponential-backoff'
import { EMPTY_DATA, ZERO_ADDRESS } from '@safe-global/protocol-kit/dist/src/utils/constants'
import {
  getCompatibilityFallbackHandlerDeployment,
  getCompatibilityFallbackHandlerDeployments,
  getProxyFactoryDeployment,
  getProxyFactoryDeployments,
  getSafeL2SingletonDeployments,
  getSafeSingletonDeployments,
  getSafeToL2SetupDeployments,
} from '@safe-global/safe-deployments'
import { ECOSYSTEM_ID_ADDRESS } from '@/config/constants'
import type { ReplayedSafeProps, UndeployedSafeProps } from '@safe-global/utils/features/counterfactual/store/types'
import { isPredictedSafeProps } from '@/features/counterfactual/services'
import {
  getSafeContractDeployment,
  getCanonicalOrFirstAddress,
} from '@safe-global/utils/services/contracts/deployments'
import {
  Safe__factory,
  Safe_proxy_factory__factory,
  Safe_to_l2_setup__factory,
} from '@safe-global/utils/types/contracts'
import { createWeb3 } from '@/hooks/wallets/web3'
import { hasMultiChainCreationFeatures } from '@/features/multichain'
import { getLatestSafeVersion } from '@safe-global/utils/utils/chains'
import { BrowserProvider as EthersBrowserProvider } from 'ethers'
import { PAYMASTER_ADDRESSES } from '@/config/constants'

export const ZKSYNC_LIKE_CHAIN_IDS = new Set<string>(['50104', '531050104'])
export const isZkSyncLikeChain = (chainId?: string): boolean => {
  if (!chainId) return false
  return ZKSYNC_LIKE_CHAIN_IDS.has(chainId)
}

// Type for the lazy-loaded activateReplayedSafe function
export type ActivateReplayedSafeFn = (
  chain: Chain,
  props: ReplayedSafeProps,
  provider: BrowserProvider,
  options: TransactionOptions,
) => Promise<TransactionResponse>

export type SafeCreationProps = {
  owners: string[]
  threshold: number
  saltNonce: number
}

/**
 * Create a Safe creation transaction via Core SDK and submits it to the wallet
 *
 * @param activateReplayedSafe - Optional function for activating replayed safes (lazy-loaded from counterfactual feature)
 */
export const createNewSafe = async (
  provider: Eip1193Provider,
  undeployedSafeProps: UndeployedSafeProps,
  chain: Chain,
  options: TransactionOptions,
  callback: (txHash: string) => void,
  isL1SafeSingleton?: boolean,
  activateReplayedSafe?: ActivateReplayedSafeFn,
): Promise<void> => {
  let txResponse: TransactionResponse
  if (isPredictedSafeProps(undeployedSafeProps)) {
    const safe = await Safe.init({
      predictedSafe: undeployedSafeProps,
      provider,
      isL1SafeSingleton,
    })

    const creationTx = await safe.createSafeDeploymentTransaction()

    const signer = await createWeb3(provider).getSigner()

    txResponse = await signer?.sendTransaction({
      ...creationTx,
      ...options,
    })
  } else {
    if (!activateReplayedSafe) {
      throw new Error('activateReplayedSafe function is required for replayed safes')
    }
    txResponse = await activateReplayedSafe(chain, undeployedSafeProps, createWeb3(provider), options)
  }
  callback(txResponse.hash)
}

/**
 * Compute the new counterfactual Safe address before it is actually created
 */
export const computeNewSafeAddress = async (
  provider: Eip1193Provider | string,
  props: UndeployedSafeProps,
  chain: Chain,
  safeVersion?: SafeVersion,
  isL1SafeSingleton?: boolean,
): Promise<string> => {
  const safeProvider = new SafeProvider({ provider })
  const saltNonce = 'saltNonce' in props ? props.saltNonce : '0'
  const propsWithNonce = 'saltNonce' in props ? props : { ...props, saltNonce }
  const chainIdString = chain.chainId?.toString()
  const chainIdBigInt = BigInt(chainIdString ?? chain.chainId)

  let replayedSafeProps: ReplayedSafeProps | undefined
  let resolvedSafeVersion = safeVersion

  try {
    replayedSafeProps = assertNewUndeployedSafeProps(propsWithNonce, chain)
    resolvedSafeVersion = resolvedSafeVersion ?? replayedSafeProps.safeVersion ?? getLatestSafeVersion(chain)
  } catch (error) {
    if (!isPredictedSafeProps(propsWithNonce)) {
      throw error
    }
    resolvedSafeVersion =
      resolvedSafeVersion ?? (propsWithNonce as PredictedSafeProps).safeDeploymentConfig?.safeVersion ?? getLatestSafeVersion(chain)
  }

  if (!resolvedSafeVersion) {
    throw new Error('Failed to resolve Safe version')
  }

  const customContracts: ContractNetworkConfig | undefined = replayedSafeProps
    ? {
        safeSingletonAddress: replayedSafeProps.masterCopy,
        safeProxyFactoryAddress: replayedSafeProps.factoryAddress,
        fallbackHandlerAddress: replayedSafeProps.safeAccountConfig.fallbackHandler,
      }
    : undefined

  // Sophon is ZKSync-based but uses different chain IDs for deployment address prediction
  const predictionChainId = isZkSyncLikeChain(chainIdString) ? 324n : chainIdBigInt

  return predictSafeAddress({
    safeProvider,
    chainId: predictionChainId,
    safeAccountConfig: replayedSafeProps?.safeAccountConfig ?? propsWithNonce.safeAccountConfig,
    safeDeploymentConfig: {
      saltNonce,
      safeVersion: resolvedSafeVersion,
    },
    isL1SafeSingleton,
    customContracts,
  })
}

export const encodeSafeSetupCall = (safeAccountConfig: ReplayedSafeProps['safeAccountConfig']) => {
  return Safe__factory.createInterface().encodeFunctionData('setup', [
    safeAccountConfig.owners,
    safeAccountConfig.threshold,
    safeAccountConfig.to,
    safeAccountConfig.data,
    safeAccountConfig.fallbackHandler,
    ZERO_ADDRESS,
    0,
    safeAccountConfig.paymentReceiver,
  ])
}

/**
 * Encode a Safe creation transaction NOT using the Core SDK because it doesn't support that
 * This is used for gas estimation.
 */
export const encodeSafeCreationTx = (undeployedSafe: UndeployedSafeProps, chain: Chain) => {
  const replayedSafeProps = assertNewUndeployedSafeProps(undeployedSafe, chain)

  return Safe_proxy_factory__factory.createInterface().encodeFunctionData('createProxyWithNonce', [
    replayedSafeProps.masterCopy,
    encodeSafeSetupCall(replayedSafeProps.safeAccountConfig),
    BigInt(replayedSafeProps.saltNonce),
  ])
}

export const estimateSafeCreationGas = async (
  chain: Chain,
  provider: Provider,
  from: string,
  undeployedSafe: UndeployedSafeProps,
  safeVersion?: SafeVersion,
): Promise<bigint> => {
  const readOnlyProxyFactoryContract = await getReadOnlyProxyFactoryContract(safeVersion ?? getLatestSafeVersion(chain))
  const encodedSafeCreationTx = encodeSafeCreationTx(undeployedSafe, chain)

  const gas = await provider.estimateGas({
    from,
    to: readOnlyProxyFactoryContract.getAddress(),
    data: encodedSafeCreationTx,
  })

  return gas
}

/**
 * Poll for safe info after creation until the safe is indexed by client-gateway
 * Uses RTK Query with exponential backoff retry (19 attempts over ~4 minutes)
 */
export const pollSafeInfo = async (chainId: string, safeAddress: string): Promise<SafeState> => {
  const store = getStoreInstance()

  // Use exponential backoff to retry RTK Query calls
  return backOff(
    async () => {
      const queryAction = safesApi.endpoints.safesGetSafeV1.initiate(
        { chainId, safeAddress },
        {
          subscribe: false,
          forceRefetch: true,
        },
      )

      const queryPromise = store.dispatch(queryAction)
      try {
        const result = await queryPromise.unwrap()
        return result
      } finally {
        queryPromise.unsubscribe()
      }
    },
    {
      startingDelay: 750,
      maxDelay: 20000,
      numOfAttempts: 19,
      retry: (e) => {
        console.info('waiting for client-gateway to provide safe information', e)
        return true
      },
    },
  )
}

export const getRedirect = (
  chainPrefix: string,
  safeAddress: string,
  redirectQuery?: string | string[],
): UrlObject | string => {
  const redirectUrl = Array.isArray(redirectQuery) ? redirectQuery[0] : redirectQuery
  const address = `${chainPrefix}:${safeAddress}`

  // Should never happen in practice
  if (!chainPrefix) return AppRoutes.index

  // Go to the dashboard if no specific redirect is provided
  if (!redirectUrl || !redirectUrl.startsWith(AppRoutes.apps.index)) {
    return { pathname: AppRoutes.home, query: { safe: address } }
  }

  // Otherwise, redirect to the provided URL (e.g. from a Safe App)

  // Track the redirect to Safe App
  trackEvent(SAFE_APPS_EVENTS.SHARED_APP_OPEN_AFTER_SAFE_CREATION)

  // We're prepending the safe address directly here because the `router.push` doesn't parse
  // The URL for already existing query params
  // TODO: Check if we can accomplish this with URLSearchParams or URL instead
  const hasQueryParams = redirectUrl.includes('?')
  const appendChar = hasQueryParams ? '&' : '?'
  return redirectUrl + `${appendChar}safe=${address}`
}

export const relaySafeCreation = async (chain: Chain, undeployedSafeProps: UndeployedSafeProps) => {
  const store = getStoreInstance()

  const replayedSafeProps = assertNewUndeployedSafeProps(undeployedSafeProps, chain)
  const encodedSafeCreationTx = encodeSafeCreationTx(replayedSafeProps, chain)

  const relayAction = relayApi.endpoints.relayRelayV1.initiate({
    chainId: chain.chainId,
    relayDto: {
      to: replayedSafeProps.factoryAddress,
      data: encodedSafeCreationTx,
      version: replayedSafeProps.safeVersion,
    },
  })

  const relayResponse = await store.dispatch(relayAction).unwrap()
  return relayResponse.taskId
}

export type UndeployedSafeWithoutSalt = Omit<ReplayedSafeProps, 'saltNonce'>

/**
 * Creates a new undeployed Safe without default config:
 *
 * Always use the L1 MasterCopy and add a migration to L2 in to the setup.
 * Use our ecosystem ID as paymentReceiver.
 *
 */
export const createNewUndeployedSafeWithoutSalt = (
  safeVersion: SafeVersion,
  safeAccountConfig: Pick<ReplayedSafeProps['safeAccountConfig'], 'owners' | 'threshold'> & {
    paymentReceiver?: string
  },
  chain: Chain,
): UndeployedSafeWithoutSalt => {
  // Create universal deployment Data across chains:
  const fallbackHandlerDeployments = getCompatibilityFallbackHandlerDeployments({
    version: safeVersion,
    network: chain.chainId,
  })
  const fallbackHandlerAddress = getCanonicalOrFirstAddress(fallbackHandlerDeployments, chain.chainId)
  const safeL2Deployments = getSafeL2SingletonDeployments({ version: safeVersion, network: chain.chainId })
  const safeL2Address = getCanonicalOrFirstAddress(safeL2Deployments, chain.chainId)

  const safeL1Deployments = getSafeSingletonDeployments({ version: safeVersion, network: chain.chainId })
  const safeL1Address = getCanonicalOrFirstAddress(safeL1Deployments, chain.chainId)

  const safeFactoryDeployments = getProxyFactoryDeployments({ version: safeVersion, network: chain.chainId })
  const safeFactoryAddress = getCanonicalOrFirstAddress(safeFactoryDeployments, chain.chainId)

  if (!safeL2Address || !safeL1Address || !safeFactoryAddress || !fallbackHandlerAddress) {
    throw new Error('No Safe deployment found')
  }

  const safeToL2SetupDeployments = getSafeToL2SetupDeployments({ version: '1.4.1', network: chain.chainId })
  const safeToL2SetupAddress = getCanonicalOrFirstAddress(safeToL2SetupDeployments, chain.chainId)
  const safeToL2SetupInterface = Safe_to_l2_setup__factory.createInterface()

  // Only do migration if the chain supports multiChain deployments and has a SafeToL2Setup deployment
  const includeMigration =
    hasMultiChainCreationFeatures(chain) && semverSatisfies(safeVersion, '>=1.4.1') && Boolean(safeToL2SetupAddress)

  const masterCopy = includeMigration ? safeL1Address : chain.l2 ? safeL2Address : safeL1Address

  const replayedSafe: Omit<ReplayedSafeProps, 'saltNonce'> = {
    factoryAddress: safeFactoryAddress,
    masterCopy,
    safeAccountConfig: {
      threshold: safeAccountConfig.threshold,
      owners: safeAccountConfig.owners,
      fallbackHandler: fallbackHandlerAddress,
      to: includeMigration && safeToL2SetupAddress ? safeToL2SetupAddress : ZERO_ADDRESS,
      data: includeMigration ? safeToL2SetupInterface.encodeFunctionData('setupToL2', [safeL2Address]) : EMPTY_DATA,
      paymentReceiver: safeAccountConfig.paymentReceiver ?? ECOSYSTEM_ID_ADDRESS,
    },
    safeVersion,
  }

  return replayedSafe
}

/**
 * Migrates a counterfactual Safe from the pre multichain era to the new predicted Safe data
 * @param predictedSafeProps
 * @param chain
 * @returns
 */
export const migrateLegacySafeProps = (predictedSafeProps: PredictedSafeProps, chain: Chain): ReplayedSafeProps => {
  const safeVersion = predictedSafeProps.safeDeploymentConfig?.safeVersion
  const saltNonce = predictedSafeProps.safeDeploymentConfig?.saltNonce
  const { chainId } = chain
  if (!safeVersion || !saltNonce) {
    throw new Error('Undeployed Safe with incomplete data.')
  }

  const fallbackHandlerDeployment = getCompatibilityFallbackHandlerDeployment({
    version: safeVersion,
    network: chainId,
  })
  const fallbackHandlerAddress = fallbackHandlerDeployment?.defaultAddress

  const masterCopyDeployment = getSafeContractDeployment(chain, safeVersion)
  const masterCopyAddress = masterCopyDeployment?.defaultAddress

  const safeFactoryDeployment = getProxyFactoryDeployment({ version: safeVersion, network: chainId })
  const safeFactoryAddress = safeFactoryDeployment?.defaultAddress

  if (!masterCopyAddress || !safeFactoryAddress || !fallbackHandlerAddress) {
    throw new Error('No Safe deployment found')
  }

  return {
    factoryAddress: safeFactoryAddress,
    masterCopy: masterCopyAddress,
    safeAccountConfig: {
      threshold: predictedSafeProps.safeAccountConfig.threshold,
      owners: predictedSafeProps.safeAccountConfig.owners,
      fallbackHandler: predictedSafeProps.safeAccountConfig.fallbackHandler ?? fallbackHandlerAddress,
      to: predictedSafeProps.safeAccountConfig.to ?? ZERO_ADDRESS,
      data: predictedSafeProps.safeAccountConfig.data ?? EMPTY_DATA,
      paymentReceiver: predictedSafeProps.safeAccountConfig.paymentReceiver ?? ZERO_ADDRESS,
    },
    safeVersion,
    saltNonce,
  }
}

export const assertNewUndeployedSafeProps = (props: UndeployedSafeProps, chain: Chain): ReplayedSafeProps => {
  if (isPredictedSafeProps(props)) {
    return migrateLegacySafeProps(props, chain)
  }

  return props
}

export const signAndExecuteSafeCreation = async (
  chain: Chain,
  undeployedSafeProps: UndeployedSafeProps,
  wallet: ConnectedWallet,
  callback: (txHash: string) => void,
  version?: SafeVersion,
) => {
  const { createProxyWithNonceCallData, proxyFactoryAddress } = await generateCreateProxyWithNonceCallData(
    chain,
    undeployedSafeProps,
    version,
  )

  const hasPaymaster = PAYMASTER_ADDRESSES[chain.chainId]

  if (hasPaymaster) {
    const paymasterParams = utils.getPaymasterParams(
      PAYMASTER_ADDRESSES[chain.chainId], // Paymaster address
      {
        type: 'General',
        innerInput: new Uint8Array(),
      },
    )

    const browserProvider = new ZKBrowserProvider(wallet.provider)

    let signer
    try {
      // Use hardcoded RPC URLs for Sophon as fallback if gateway RPC fails
      let rpcUrl = chain.rpcUri.value

      if (chain.chainId === '531050104') {
        // Sophon Testnet - use the correct RPC URL
        rpcUrl = 'https://rpc.testnet.sophon.xyz'
      } else if (chain.chainId === '50104') {
        // Sophon Mainnet
        rpcUrl = 'https://rpc.sophon.xyz'
      }

      const zkProvider = new ZKProvider(rpcUrl, { name: chain.chainName, chainId: Number(chain.chainId) })

      const browserSigner = await browserProvider.getSigner()

      // Get the private key from the browser signer (this might not work in browser)
      try {
        // This approach might not work in browser environment
        throw new Error('Wallet pattern not suitable for browser')
      } catch (error) {
        // Use Signer (L2) as required for Sophon
        signer = Signer.from(browserSigner, Number(chain.chainId), zkProvider)

        // @ts-ignore - Accessing protected property
        signer.providerL2 = zkProvider

        // Also try to set it through the prototype if needed
        Object.defineProperty(signer, 'providerL2', {
          value: zkProvider,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      }
    } catch (error) {
      console.error('❌ [PAYMASTER] Error creating signer:', error)
      throw error
    }

    const transactionData = {
      type: utils.EIP712_TX_TYPE,
      from: wallet.address,
      to: proxyFactoryAddress,
      data: createProxyWithNonceCallData,
      customData: {
        gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
        paymasterParams,
      },
    }

    // Override populateFeeData to bypass the providerL2 check
    // @ts-ignore - Accessing protected method
    const originalPopulateFeeData = signer.populateFeeData.bind(signer)
    // @ts-ignore - Overriding protected method
    signer.populateFeeData = async function (transaction: any) {
      // Call the original method but catch the providerL2 error
      try {
        return await originalPopulateFeeData(transaction)
      } catch (error) {
        if ((error as Error).message === 'Initialize provider L2') {
          console.log('💳 [PAYMASTER] Bypassing providerL2 check error')
          // Manually populate fee data without providerL2 check
          const tx = { ...transaction }

          // Get current gas prices from the provider
          const feeData = await this.provider.getFeeData()

          // Set higher gas values for faster transaction processing
          if (!tx.gasLimit) {
            tx.gasLimit = 5000000 // Much higher gas limit for faster processing
          }
          if (!tx.maxFeePerGas) {
            // Use much higher gas prices for faster confirmation
            tx.maxFeePerGas = feeData.maxFeePerGas
              ? feeData.maxFeePerGas * 3n // 3x current price for speed
              : 100000000000 // 100 gwei default (very high for speed)
          }
          if (!tx.maxPriorityFeePerGas) {
            tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
              ? feeData.maxPriorityFeePerGas * 3n // 3x current price for speed
              : 10000000000 // 10 gwei default (very high for speed)
          }

          return tx
        }
        throw error
      }
    }

    const boundSendTransaction = signer.sendTransaction.bind(signer)
    const tx = await boundSendTransaction(transactionData)

    console.log('✅ [PAYMASTER] Transaction sent successfully:', tx.hash)
    callback(tx.hash)
  } else {
    console.log('🔧 [PAYMASTER] No paymaster found, using standard EVM transaction')

    try {
      const ethersBrowserProvider = new EthersBrowserProvider(wallet.provider)
      const signer = await ethersBrowserProvider.getSigner()

      const transactionData = {
        from: wallet.address,
        to: proxyFactoryAddress,
        data: createProxyWithNonceCallData,
      }

      const tx = await signer.sendTransaction(transactionData)

      console.log('✅ Transaction sent successfully:', tx.hash)
      callback(tx.hash)
    } catch (error) {
      console.error('❌ Error sending transaction:', error)
      throw error
    }
  }
}

const generateCreateProxyWithNonceCallData = async (
  chain: Chain,
  undeployedSafeProps: UndeployedSafeProps,
  version?: SafeVersion,
) => {
  const safeVersion = version ?? getLatestSafeVersion(chain)
  const readOnlyProxyFactoryContract = await getReadOnlyProxyFactoryContract(safeVersion)
  const proxyFactoryAddress = readOnlyProxyFactoryContract.getAddress()
  const replayedSafeProps = assertNewUndeployedSafeProps(undeployedSafeProps, chain)
  const createProxyWithNonceCallData = Safe_proxy_factory__factory.createInterface().encodeFunctionData(
    'createProxyWithNonce',
    [
      replayedSafeProps.masterCopy,
      encodeSafeSetupCall(replayedSafeProps.safeAccountConfig),
      BigInt(replayedSafeProps.saltNonce),
    ],
  )
  return { createProxyWithNonceCallData, proxyFactoryAddress }
}
