// Re-export address utilities from Safe's utils package for compatibility
export { validateAddress } from '@safe-global/utils/utils/validation'
export { parsePrefixedAddress, cleanInputValue, sameAddress } from '@safe-global/utils/utils/addresses'

// Additional address validation helpers specifically for Safe Wallet
export const isValidAddress = (address: string): boolean => {
  try {
    // Simple address validation - check if it's a valid hex string
    return /^0x[a-fA-F0-9]{40}$/.test(address)
  } catch {
    return false
  }
}

export const checksumAddress = (address: string): string => {
  if (!isValidAddress(address)) {
    throw new Error(`Invalid address: ${address}`)
  }
  return address
}
