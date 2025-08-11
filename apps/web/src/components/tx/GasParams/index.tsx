import type { ReactElement } from 'react'
import { Skeleton, Typography } from '@mui/material'
import type { ChainInfo } from '@safe-global/safe-gateway-typescript-sdk'
import { useCurrentChain } from '@/hooks/useChains'
import { formatVisualAmount } from '@safe-global/utils/utils/formatters'
import { type AdvancedParameters } from '../AdvancedParams/types'
import classnames from 'classnames'
import css from './styles.module.css'
import madProps from '@/utils/mad-props'

type GasParamsProps = {
  params: AdvancedParameters
  isExecution: boolean
  isEIP1559?: boolean
  onEdit?: () => void
  gasLimitError?: Error
  willRelay?: boolean
}

export const _GasParams = ({
  params,
  isExecution,
  gasLimitError,
}: Omit<GasParamsProps, 'isEIP1559' | 'willRelay'> & { chain?: ChainInfo }): ReactElement => {
  const { nonce } = params
  // Removed unused variables: userNonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas, onChangeExpand, isLoading, isError, totalFee, gasLimitString, maxFeePerGasGwei, maxPrioGasGwei, EditComponent
  // const onEditClick = (e: SyntheticEvent) => {
  //   e.preventDefault()
  //   onEdit?.()
  // }

  return (
    <div className={classnames({ [css.error]: gasLimitError })}>
      {isExecution ? (
        <Typography display="flex" alignItems="center" width={1}>
          <span style={{ flex: '1' }}>Estimated fee </span>
          <span>Free (Sponsored by Sophon)</span>
        </Typography>
      ) : (
        <Typography>
          Signing the transaction with nonce&nbsp;
          {nonce !== undefined ? nonce : <Skeleton variant="text" sx={{ display: 'inline-block', minWidth: '2em' }} />}
        </Typography>
      )}
      {/* <Accordion
        elevation={0}
        onChange={onChangeExpand}
        className={classnames({ [css.withExecutionMethod]: isExecution })}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} className={accordionCss.accordion}>
          {isExecution ? (
            <Typography
              sx={{
                display: 'flex',
                alignItems: 'center',
                width: 1,
              }}
            >
              <span style={{ flex: '1' }}>Estimated fee </span>
              {gasLimitError ? (
                <>
                  <SvgIcon
                    component={WarningIcon}
                    inheritViewBox
                    fontSize="small"
                    sx={{ color: 'var(--color-error-main)', mr: 'var(--space-1)' }}
                  />
                  <span style={{ fontWeight: 'normal' }}>Cannot Estimate</span>
                </>
              ) : isLoading ? (
                <Skeleton variant="text" sx={{ display: 'inline-block', minWidth: '7em' }} />
              ) : (
                <span>{willRelay ? 'Free' : `${totalFee} ${chain?.nativeCurrency.symbol}`}</span>
              )}
            </Typography>
          ) : (
            <Typography>
              Signing the transaction with nonce&nbsp;
              {nonce !== undefined ? (
                nonce
              ) : (
                <Skeleton variant="text" sx={{ display: 'inline-block', minWidth: '2em' }} />
              )}
            </Typography>
          )}
        </AccordionSummary>

        <AccordionDetails>
          {nonce !== undefined && (
            <GasDetail isLoading={false} name="Safe Account transaction nonce" value={nonce.toString()} />
          )}

          {safeTxGas !== undefined && <GasDetail isLoading={false} name="safeTxGas" value={safeTxGas.toString()} />}

          {isExecution && (
            <>
              {userNonce !== undefined && (
                <GasDetail isLoading={false} name="Wallet nonce" value={userNonce.toString()} />
              )}

              <GasDetail isLoading={isLoading} name="Gas limit" value={isError ? 'Cannot estimate' : gasLimitString} />

              {isEIP1559 ? (
                <>
                  <GasDetail isLoading={isLoading} name="Max priority fee (Gwei)" value={maxPrioGasGwei} />
                  <GasDetail isLoading={isLoading} name="Max fee (Gwei)" value={maxFeePerGasGwei} />
                </>
              ) : (
                <GasDetail isLoading={isLoading} name="Gas price (Gwei)" value={maxFeePerGasGwei} />
              )}
            </>
          )}

          {onEdit && EditComponent}
        </AccordionDetails>
      </Accordion> */}
    </div>
  )
}

const GasParams = madProps(_GasParams, {
  chain: useCurrentChain,
})

export default GasParams
