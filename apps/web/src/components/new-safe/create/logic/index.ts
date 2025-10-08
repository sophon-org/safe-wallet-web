import type { SafeVersion } from '@safe-global/types-kit'
import { type Eip1193Provider, type Provider } from 'ethers'
import semverSatisfies from 'semver/functions/satisfies'

import { getSafeInfo, type SafeInfo, type ChainInfo, relayTransaction } from '@safe-global/safe-gateway-typescript-sdk'
import { getReadOnlyProxyFactoryContract } from '@/services/contracts/safeContracts'
import type { UrlObject } from 'url'
import { AppRoutes } from '@/config/routes'
import { SAFE_APPS_EVENTS, trackEvent } from '@/services/analytics'
import { predictSafeAddress, SafeProvider } from '@safe-global/protocol-kit'
import type { PredictedSafeProps } from '@safe-global/protocol-kit'
import { assertValidSafeVersion } from '@safe-global/utils/services/contracts/utils'

// Helper function to validate Safe version - returns boolean instead of throwing
const isValidSafeVersion = (version: string): boolean => {
  try {
    assertValidSafeVersion(version)
    return true
  } catch {
    return false
  }
}

import { backOff } from 'exponential-backoff'
import { BrowserProvider, Provider as ZKProvider, Signer, utils } from 'zksync-ethers'
import { type ConnectedWallet } from '@/hooks/wallets/useOnboard'
import { EMPTY_DATA, ZERO_ADDRESS } from '@safe-global/protocol-kit/dist/src/utils/constants'
import { getLatestSafeVersion } from '@/utils/chains'
import {
  getCompatibilityFallbackHandlerDeployment,
  getProxyFactoryDeployment,
  getSafeL2SingletonDeployment,
  getSafeSingletonDeployment,
  getSafeToL2SetupDeployment,
} from '@safe-global/safe-deployments'
import { ECOSYSTEM_ID_ADDRESS, PAYMASTER_ADDRESSES } from '@/config/constants'
import type { ReplayedSafeProps, UndeployedSafeProps } from '@safe-global/utils/features/counterfactual/store/types'
import { activateReplayedSafe, isPredictedSafeProps } from '@/features/counterfactual/utils'
import { getSafeContractDeployment } from '@safe-global/utils/services/contracts/deployments'
import {
  Safe__factory,
  Safe_proxy_factory__factory,
  Safe_to_l2_setup__factory,
} from '@safe-global/utils/types/contracts'
import { createWeb3 } from '@/hooks/wallets/web3'
import { hasMultiChainCreationFeatures } from '@/features/multichain/utils/utils'

export type SafeCreationProps = {
  owners: string[]
  threshold: number
  saltNonce: number
}

// SafeFactory deprecated, replaced with direct SDK usage
const createSafeInstance = async (provider: Eip1193Provider, safeVersion: SafeVersion, isL1SafeSingleton?: boolean) => {
  if (!isValidSafeVersion(safeVersion)) {
    throw new Error('Invalid Safe version')
  }
  // Return configuration for Safe creation using new SDK pattern
  return { provider, safeVersion, isL1SafeSingleton }
}

/**
 * Create a Safe creation transaction via Core SDK and submits it to the wallet
 */
export const createNewSafe = async (
  provider: Eip1193Provider,
  undeployedSafeProps: UndeployedSafeProps,
  safeVersion: SafeVersion,
  chain: ChainInfo,
  options: any, // DeploySafeProps deprecated
  callback: (txHash: string) => void,
  isL1SafeSingleton?: boolean,
): Promise<void> => {
  const _safeConfig = await createSafeInstance(provider, safeVersion, isL1SafeSingleton)

  if (isPredictedSafeProps(undeployedSafeProps)) {
    // Use signAndExecuteSafeCreation instead of deprecated safeFactory.deploySafe
    signAndExecuteSafeCreation(
      chain,
      undeployedSafeProps,
      { provider, address: undeployedSafeProps.safeAccountConfig.owners[0] } as ConnectedWallet,
      callback,
      safeVersion,
    )
  } else {
    const txResponse = await activateReplayedSafe(chain, undeployedSafeProps, createWeb3(provider), options)
    callback(txResponse.hash)
  }
}

/**
 * Compute the new counterfactual Safe address before it is actually created
 */
export const computeNewSafeAddress = async (
  provider: Eip1193Provider | string,
  props: UndeployedSafeProps, // Use the full union type that includes saltNonce
  chain: ChainInfo,
  safeVersion?: SafeVersion,
  isL1SafeSingleton?: boolean,
): Promise<string> => {
  const safeProvider = new SafeProvider({ provider })

  // Handle different prop types - both types have safeAccountConfig
  const saltNonce = 'saltNonce' in props ? props.saltNonce : '0'

  return predictSafeAddress({
    safeProvider,
    chainId: BigInt(chain.chainId),
    safeAccountConfig: props.safeAccountConfig,
    safeDeploymentConfig: {
      saltNonce,
      safeVersion: safeVersion ?? getLatestSafeVersion(),
    },
    isL1SafeSingleton,
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
export const encodeSafeCreationTx = (undeployedSafe: UndeployedSafeProps, chain: ChainInfo) => {
  const replayedSafeProps = assertNewUndeployedSafeProps(undeployedSafe, chain)

  return Safe_proxy_factory__factory.createInterface().encodeFunctionData('createProxyWithNonce', [
    replayedSafeProps.masterCopy,
    encodeSafeSetupCall(replayedSafeProps.safeAccountConfig),
    BigInt(replayedSafeProps.saltNonce),
  ])
}

export const estimateSafeCreationGas = async (
  chain: ChainInfo,
  provider: Provider,
  from: string,
  undeployedSafe: UndeployedSafeProps,
  safeVersion?: SafeVersion,
): Promise<bigint> => {
  const readOnlyProxyFactoryContract = await getReadOnlyProxyFactoryContract(safeVersion ?? getLatestSafeVersion())
  const encodedSafeCreationTx = encodeSafeCreationTx(undeployedSafe, chain)

  const gas = await provider.estimateGas({
    from,
    to: readOnlyProxyFactoryContract.getAddress(),
    data: encodedSafeCreationTx,
  })

  return gas
}

export const pollSafeInfo = async (chainId: string, safeAddress: string): Promise<SafeInfo> => {
  // exponential delay between attempts for around 4 min
  return backOff(() => getSafeInfo(chainId, safeAddress), {
    startingDelay: 750,
    maxDelay: 20000,
    numOfAttempts: 19,
    retry: (e) => {
      console.info('waiting for client-gateway to provide safe information', e)
      return true
    },
  })
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

export const relaySafeCreation = async (chain: ChainInfo, undeployedSafeProps: UndeployedSafeProps) => {
  const replayedSafeProps = assertNewUndeployedSafeProps(undeployedSafeProps, chain)
  const encodedSafeCreationTx = encodeSafeCreationTx(replayedSafeProps, chain)

  const relayResponse = await relayTransaction(chain.chainId, {
    to: replayedSafeProps.factoryAddress,
    data: encodedSafeCreationTx,
    version: replayedSafeProps.safeVersion,
  })

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
  chain: ChainInfo,
): UndeployedSafeWithoutSalt => {
  // Create universal deployment Data across chains:
  const fallbackHandlerDeployment = getCompatibilityFallbackHandlerDeployment({
    version: safeVersion,
    network: chain.chainId,
  })
  const fallbackHandlerAddress = fallbackHandlerDeployment?.networkAddresses[chain.chainId]
  const safeL2Deployment = getSafeL2SingletonDeployment({ version: safeVersion, network: chain.chainId })
  const safeL2Address = safeL2Deployment?.networkAddresses[chain.chainId]

  const safeL1Deployment = getSafeSingletonDeployment({ version: safeVersion, network: chain.chainId })
  const safeL1Address = safeL1Deployment?.networkAddresses[chain.chainId]

  const safeFactoryDeployment = getProxyFactoryDeployment({ version: safeVersion, network: chain.chainId })
  const safeFactoryAddress = safeFactoryDeployment?.networkAddresses[chain.chainId]

  if (!safeL2Address || !safeL1Address || !safeFactoryAddress || !fallbackHandlerAddress) {
    throw new Error('No Safe deployment found')
  }

  const safeToL2SetupDeployment = getSafeToL2SetupDeployment({ version: '1.4.1', network: chain.chainId })
  const safeToL2SetupAddress = safeToL2SetupDeployment?.networkAddresses[chain.chainId]
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
export const migrateLegacySafeProps = (predictedSafeProps: PredictedSafeProps, chain: ChainInfo): ReplayedSafeProps => {
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

export const assertNewUndeployedSafeProps = (props: UndeployedSafeProps, chain: ChainInfo): ReplayedSafeProps => {
  if (isPredictedSafeProps(props)) {
    return migrateLegacySafeProps(props, chain)
  }

  return props
}

export const signAndExecuteSafeCreation = async (
  chain: ChainInfo,
  undeployedSafeProps: UndeployedSafeProps,
  wallet: ConnectedWallet,
  callback: (txHash: string) => void,
  version?: SafeVersion,
) => {
  console.log('💳 [PAYMASTER] Starting signAndExecuteSafeCreation')
  console.log('💳 [PAYMASTER] Chain:', chain.chainId, chain.chainName)
  console.log('💳 [PAYMASTER] Wallet address:', wallet.address)
  console.log('💳 [PAYMASTER] UndeployedSafeProps:', undeployedSafeProps)
  console.log('💳 [PAYMASTER] Version:', version)
  console.log('💳 [PAYMASTER] Environment check - IS_PRODUCTION:', process.env.NODE_ENV === 'production')
  console.log(
    '💳 [PAYMASTER] Gateway URL being used:',
    process.env.NEXT_PUBLIC_GATEWAY_URL_PRODUCTION || process.env.NEXT_PUBLIC_GATEWAY_URL_STAGING,
  )

  const { createProxyWithNonceCallData, proxyFactoryAddress } = await generateCreateProxyWithNonceCallData(
    chain,
    undeployedSafeProps,
    version,
  )

  console.log('💳 [PAYMASTER] Generated call data:', createProxyWithNonceCallData)
  console.log('💳 [PAYMASTER] Proxy factory address:', proxyFactoryAddress)
  console.log('💳 [PAYMASTER] PAYMASTER_ADDRESSES:', PAYMASTER_ADDRESSES)
  console.log('💳 [PAYMASTER] Chain ID:', chain.chainId)
  console.log('💳 [PAYMASTER] Paymaster address for chain:', PAYMASTER_ADDRESSES[chain.chainId])

  if (!PAYMASTER_ADDRESSES[chain.chainId]) {
    console.error('❌ [PAYMASTER] No paymaster address found for chain:', chain.chainId)
    throw new Error(`No paymaster address found for chain ${chain.chainId}`)
  }

  const paymasterParams = utils.getPaymasterParams(
    PAYMASTER_ADDRESSES[chain.chainId], // Paymaster address
    {
      type: 'General',
      innerInput: new Uint8Array(),
    },
  )

  console.log('💳 [PAYMASTER] Generated paymaster params:', paymasterParams)
  console.log('💳 [PAYMASTER] Creating browser provider and signer')
  console.log('💳 [PAYMASTER] Chain RPC URI:', chain.rpcUri.value)
  console.log('💳 [PAYMASTER] Chain RPC URI authentication:', chain.rpcUri.authentication)
  console.log('💳 [PAYMASTER] Chain ID (number):', Number(chain.chainId))
  console.log('💳 [PAYMASTER] Chain name:', chain.chainName)
  console.log('💳 [PAYMASTER] Full chain object:', chain)

  const browserProvider = new BrowserProvider(wallet.provider)
  console.log('💳 [PAYMASTER] Browser provider created:', !!browserProvider)

  let signer
  try {
    // Use hardcoded RPC URLs for Sophon as fallback if gateway RPC fails
    let rpcUrl = chain.rpcUri.value
    console.log('💳 [PAYMASTER] Original gateway RPC URL:', rpcUrl)

    if (chain.chainId === '531050104') {
      // Sophon Testnet - use the correct RPC URL
      rpcUrl = 'https://rpc.testnet.sophon.xyz'
      console.log('💳 [PAYMASTER] Using correct Sophon Testnet RPC:', rpcUrl)
    } else if (chain.chainId === '50104') {
      // Sophon Mainnet
      rpcUrl = 'https://rpc.sophon.xyz'
      console.log('💳 [PAYMASTER] Using hardcoded Sophon Mainnet RPC:', rpcUrl)
    }

    const zkProvider = new ZKProvider(rpcUrl, { name: chain.chainName, chainId: Number(chain.chainId) })
    console.log('💳 [PAYMASTER] ZK Provider created:', !!zkProvider)
    console.log('💳 [PAYMASTER] ZK Provider chain ID:', zkProvider.chainId)

    // Test if ZKProvider is working
    console.log('💳 [PAYMASTER] Testing ZKProvider connectivity...')
    const network = await zkProvider.getNetwork()
    console.log('💳 [PAYMASTER] ZK Provider network:', network)

    // Test if we can get block number
    const blockNumber = await zkProvider.getBlockNumber()
    console.log('💳 [PAYMASTER] ZK Provider block number:', blockNumber)

    const browserSigner = await browserProvider.getSigner()
    console.log('💳 [PAYMASTER] Browser signer obtained:', !!browserSigner)

    // Try creating signer using Wallet pattern instead of Signer.from
    console.log('💳 [PAYMASTER] Trying Wallet pattern...')

    // Get the private key from the browser signer (this might not work in browser)
    try {
      // This approach might not work in browser environment
      console.log('💳 [PAYMASTER] Wallet pattern not suitable for browser')
      throw new Error('Wallet pattern not suitable for browser')
    } catch (error) {
      console.log('💳 [PAYMASTER] Falling back to Signer.from pattern')

      // Use Signer (L2) as required for Sophon
      console.log('💳 [PAYMASTER] Using Signer (L2) for Sophon...')
      signer = Signer.from(browserSigner, Number(chain.chainId), zkProvider)

      // Force set providerL2 to ensure it's available
      console.log('💳 [PAYMASTER] Force setting providerL2')
      signer.providerL2 = zkProvider

      // Also try to set it through the prototype if needed
      Object.defineProperty(signer, 'providerL2', {
        value: zkProvider,
        writable: true,
        enumerable: true,
        configurable: true,
      })
    }

    console.log('💳 [PAYMASTER] Signer created with Signer.from')
    console.log('💳 [PAYMASTER] Signer type:', signer.constructor.name)
    console.log('💳 [PAYMASTER] Signer has providerL2:', 'providerL2' in signer)

    // Try to access providerL2 through different methods
    try {
      console.log('💳 [PAYMASTER] Direct providerL2 access:', !!signer.providerL2)
    } catch (error) {
      console.log('💳 [PAYMASTER] Cannot access providerL2 directly:', error.message)
    }

    // Try to access through _providerL2 method if it exists
    try {
      if (typeof signer._providerL2 === 'function') {
        const providerL2 = signer._providerL2()
        console.log('💳 [PAYMASTER] _providerL2 method result:', !!providerL2)
      }
    } catch (error) {
      console.log('💳 [PAYMASTER] _providerL2 method error:', error.message)
    }

    console.log('💳 [PAYMASTER] Signer created successfully')
    console.log('💳 [PAYMASTER] Signer provider:', !!signer.provider)
    console.log('💳 [PAYMASTER] Signer providerL2 check:', signer.providerL2 ? 'EXISTS' : 'MISSING')

    // Test if signer is working
    const signerAddress = await signer.getAddress()
    console.log('💳 [PAYMASTER] Signer address:', signerAddress)
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

  console.log('💳 [PAYMASTER] Transaction data:', transactionData)
  console.log('💳 [PAYMASTER] Sending transaction...')

  // Debug: Check signer state before sending transaction
  console.log('💳 [PAYMASTER] Signer before sendTransaction:')
  console.log('💳 [PAYMASTER] - Signer provider:', !!signer.provider)
  console.log('💳 [PAYMASTER] - Signer providerL2:', !!signer.providerL2)
  console.log('💳 [PAYMASTER] - Signer address:', await signer.getAddress())

  // Try to ensure the context is maintained by binding the method
  console.log('💳 [PAYMASTER] About to call sendTransaction...')
  console.log('💳 [PAYMASTER] Signer constructor name:', signer.constructor.name)
  console.log('💳 [PAYMASTER] Signer instanceof Signer:', signer instanceof Signer)

  // Override populateFeeData to bypass the providerL2 check
  const originalPopulateFeeData = signer.populateFeeData.bind(signer)
  signer.populateFeeData = async function (transaction) {
    console.log('💳 [PAYMASTER] Custom populateFeeData called')
    console.log('💳 [PAYMASTER] this.providerL2 in custom method:', !!this.providerL2)

    // Call the original method but catch the providerL2 error
    try {
      return await originalPopulateFeeData(transaction)
    } catch (error) {
      if (error.message === 'Initialize provider L2') {
        console.log('💳 [PAYMASTER] Bypassing providerL2 check error')
        // Manually populate fee data without providerL2 check
        const tx = { ...transaction }

        // Get current gas prices from the provider
        const feeData = await this.provider.getFeeData()
        console.log('💳 [PAYMASTER] Current fee data:', feeData)

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

        console.log('💳 [PAYMASTER] Final gas values:', {
          gasLimit: tx.gasLimit,
          maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        })
        return tx
      }
      throw error
    }
  }

  const boundSendTransaction = signer.sendTransaction.bind(signer)
  const tx = await boundSendTransaction(transactionData)

  console.log('✅ [PAYMASTER] Transaction sent successfully:', tx.hash)
  callback(tx.hash)
}

const generateCreateProxyWithNonceCallData = async (
  chain: ChainInfo,
  undeployedSafeProps: UndeployedSafeProps,
  version?: SafeVersion,
) => {
  console.log('🔧 [PROXY FACTORY] Starting generateCreateProxyWithNonceCallData')
  console.log('🔧 [PROXY FACTORY] Chain:', chain.chainId, chain.chainName)
  console.log('🔧 [PROXY FACTORY] UndeployedSafeProps:', undeployedSafeProps)
  console.log('🔧 [PROXY FACTORY] Version:', version)

  const latestSafeVersion = getLatestSafeVersion()
  const safeVersion = version ?? latestSafeVersion
  console.log('🔧 [PROXY FACTORY] Safe version to use:', safeVersion)

  const readOnlyProxyFactoryContract = await getReadOnlyProxyFactoryContract(safeVersion)
  const proxyFactoryAddress = readOnlyProxyFactoryContract.getAddress()
  console.log('🔧 [PROXY FACTORY] Proxy factory address:', proxyFactoryAddress)

  const replayedSafeProps = assertNewUndeployedSafeProps(undeployedSafeProps, chain)
  console.log('🔧 [PROXY FACTORY] Replayed safe props:', replayedSafeProps)
  const createProxyWithNonceCallData = Safe_proxy_factory__factory.createInterface().encodeFunctionData(
    'createProxyWithNonce',
    [
      replayedSafeProps.masterCopy,
      encodeSafeSetupCall(replayedSafeProps.safeAccountConfig),
      BigInt(replayedSafeProps.saltNonce),
    ],
  )

  console.log('🔧 [PROXY FACTORY] Generated call data:', createProxyWithNonceCallData)
  console.log('🔧 [PROXY FACTORY] Master copy:', replayedSafeProps.masterCopy)
  console.log('🔧 [PROXY FACTORY] Salt nonce:', replayedSafeProps.saltNonce)

  return { createProxyWithNonceCallData, proxyFactoryAddress }
}
