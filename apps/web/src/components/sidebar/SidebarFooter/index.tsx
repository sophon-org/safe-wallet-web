import { type ReactElement, useEffect } from 'react'
import { loadBeamer } from '@/services/beamer'
import { useAppSelector } from '@/store'
import { CookieAndTermType, hasConsentFor } from '@/store/cookiesAndTermsSlice'
import HelpCenterIcon from '@/public/images/sidebar/help-center.svg'
import { Divider, ListItem, SvgIcon, Box, useTheme, Link } from '@mui/material'
import DebugToggle from '../DebugToggle'
import { IS_PRODUCTION } from '@/config/constants'
import { useCurrentChain } from '@/hooks/useChains'
import { NEW_SUGGESTION_FORM, PROTOFIRE_SUPPORT_LINK } from '@safe-global/utils/config/constants'
import { SidebarListItemButton, SidebarListItemIcon, SidebarListItemText } from '../SidebarList'
import ProtofireLogo from '@/public/images/protofire-logo.svg'
import SuggestionIcon from '@/public/images/common/lightbulb.svg'
import darkPalette from '@/components/theme/darkPalette'

const SidebarFooter = (): ReactElement => {
  const chain = useCurrentChain()
  const hasBeamerConsent = useAppSelector((state) => hasConsentFor(state, CookieAndTermType.UPDATES))
  const theme = useTheme()

  useEffect(() => {
    // Initialise Beamer when consent was previously given
    if (hasBeamerConsent && chain?.shortName) {
      loadBeamer(chain.shortName)
    }
  }, [hasBeamerConsent, chain?.shortName])

  return (
    <>
      {!IS_PRODUCTION && (
        <>
          <ListItem disablePadding>
            <DebugToggle />
          </ListItem>

          <Divider flexItem />
        </>
      )}
      <ListItem style={{ padding: 'var(--space-1)' }}>
        <a target="_blank" rel="noopener noreferrer" href={PROTOFIRE_SUPPORT_LINK} style={{ width: '100%' }}>
          <SidebarListItemButton>
            <SidebarListItemIcon color="primary">
              <HelpCenterIcon />
            </SidebarListItemIcon>
            <SidebarListItemText data-testid="list-item-need-help" bold>
              Need help?
            </SidebarListItemText>
          </SidebarListItemButton>
        </a>
      </ListItem>

      <ListItem style={{ padding: '0 var(--space-1) 0' }}>
        <a target="_blank" rel="noopener noreferrer" href={NEW_SUGGESTION_FORM} style={{ width: '100%' }}>
          <SidebarListItemButton
            style={{
              color: 'black',
              backgroundColor:
                theme.palette.mode === 'dark' ? theme.palette.primary.main : theme.palette.secondary.main,
            }}
          >
            <SidebarListItemIcon>
              <Box
                sx={{
                  '& svg': {
                    '& path': () => ({
                      fill: 'black !important',
                    }),
                  },
                }}
              >
                <SuggestionIcon />
              </Box>
            </SidebarListItemIcon>
            <SidebarListItemText bold>New Features Suggestion?</SidebarListItemText>
          </SidebarListItemButton>
        </a>
      </ListItem>

      <ListItem>
        <SidebarListItemText
          slotProps={{
            primary: {
              variant: 'caption',
            },
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            Supported by <SvgIcon component={ProtofireLogo} inheritViewBox fontSize="small" sx={{ mx: 0.5 }} />
            <Link
              target="_blank"
              href="https://protofire.io/services/solution/safe-deployment"
              sx={{ color: darkPalette.primary.main, textDecoration: 'none' }}
            >
              Protofire
            </Link>
          </Box>
        </SidebarListItemText>
      </ListItem>
    </>
  )
}

export default SidebarFooter
