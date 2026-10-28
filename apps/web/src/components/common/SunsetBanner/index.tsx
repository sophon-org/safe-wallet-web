import { type ReactElement } from 'react'
import { Link, Typography } from '@mui/material'
import ErrorMessage from '@/components/tx/ErrorMessage'
import useChainId from '@/hooks/useChainId'
import { useHasFeature } from '@/hooks/useChains'
import { FEATURES } from '@safe-global/utils/utils/chains'
import { SUNSET_BANNERS } from '@/config/constants.extra'

const SunsetBanner = (): ReactElement | null => {
  const chainId = useChainId()
  const isSunsetBannerEnabled = useHasFeature(FEATURES.SUNSET_BANNER)
  const banner = SUNSET_BANNERS[chainId]

  if (!isSunsetBannerEnabled || !banner) return null

  return (
    <ErrorMessage level="warning" title={banner.title}>
      <Typography variant="body2">{banner.description}</Typography>
      {banner.link && (
        <Link href={banner.link.href} target="_blank" rel="noopener noreferrer" variant="body2" fontWeight="bold">
          {banner.link.label}
        </Link>
      )}
    </ErrorMessage>
  )
}

export default SunsetBanner
