export const NEW_SUGGESTION_FORM = 'https://safe-feature-request.protofire.io'
export const TERMS_LINK =
  process.env.NEXT_PUBLIC_TERMS_LINK ||
  'https://raw.githubusercontent.com/protofire/safe-legal/refs/heads/main/terms.md'
export const COOKIE_LINK =
  process.env.NEXT_PUBLIC_COOKIE_LINK ||
  'https://raw.githubusercontent.com/protofire/safe-legal/refs/heads/main/cookie.md'

export const PROTOFIRE_SUPPORT_LINK = 'https://safe-support.protofire.io'

export const IMPRINT_LINK =
  process.env.NEXT_PUBLIC_IMPRINT_LINK ||
  'https://raw.githubusercontent.com/protofire/safe-legal/refs/heads/main/imprint.md'

export const LIFI_WIDGET_URL = process.env.NEXT_PUBLIC_LIFI_WIDGET_URL || 'https://lifi-swap.safe.protofire.io/'

export const OZ_SAFE_UTILS_URL = 'https://safeutils.openzeppelin.com'
export const PROTOFIRE_SAFE_UTILS_URL = 'https://safeutils.protofire.io'

// Sunset banners per chain ID
const CROSSFI_SUNSET_BANNER = {
  title: 'CrossFi Safe Support Sunsetting',
  description:
    'Dear users, Support for Safe on CrossFi will end soon. Please withdraw your funds until April 17, 2029.',
}

const SOPHON_SUNSET_BANNER = {
  title: 'Sophon mainnet shuts down on November 30, 2026',
  description: 'This Safe interface will be discontinued on that date. Please withdraw or move your funds before then.',
  link: { href: 'https://x.com/Sophon/status/2112253258030882831', label: 'Read the official announcement →' },
}

export const SUNSET_BANNERS: Record<
  string,
  { title: string; description: string; link?: { href: string; label: string } }
> = {
  '50104': SOPHON_SUNSET_BANNER,
  '531050104': SOPHON_SUNSET_BANNER,
  '4158': CROSSFI_SUNSET_BANNER,
  '4157': CROSSFI_SUNSET_BANNER,
}

// TODO: move to types
export interface TemplateConfig {
  EIP155: boolean
  SUPPORTED_VERSIONS: string[]
  ALLOWANCE_MODULE_OVERRIDE?: {
    '0.1.0': string
    '0.1.1': string
  }
  SAFE_UTILS_SUPPORTED?: boolean
  EXTRA_FOOTER_LINKS?: {
    label: string
    link: string
  }[]
  LOGO_DIMENSIONS?: {
    WELCOME?: {
      W?: string
      H?: string
    }
    HEADER?: {
      W?: string
      H?: string
    }
  }
  WELCOME_PALETTE?: string
  IS_LICENSED?: boolean
}
