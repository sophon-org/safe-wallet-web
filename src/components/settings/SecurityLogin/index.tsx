import { Box, Grid, Paper, Typography } from '@mui/material'
import SocialSignerMFA from './SocialSignerMFA'
import SocialSignerExport from './SocialSignerExport'

const SecurityLogin = () => {
  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Paper sx={{ p: 4 }}>
        <Grid container spacing={3}>
          <Grid item lg={4} xs={12}>
            <Typography variant="h4" fontWeight="bold" mb={1}>
              Multi-factor Authentication
            </Typography>
          </Grid>

          <Grid item xs>
            <SocialSignerMFA />
          </Grid>
        </Grid>
      </Paper>
      <Paper sx={{ p: 4, mt: 2 }}>
        <Grid container spacing={3}>
          <Grid item lg={4} xs={12}>
            <Typography variant="h4" fontWeight="bold" mb={1}>
              Social login signer export
            </Typography>
          </Grid>
          <Grid item xs>
            <SocialSignerExport />
          </Grid>
        </Grid>
      </Paper>
    </Box>
  )
}

export default SecurityLogin
