import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    TextField,
    Link,
    Box,
    Divider,
    IconButton, useTheme
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import platform from '../../packages/platform'


interface Props {
    open: boolean
    setOpen: (open: boolean) => void
}
export default function DropboxLogin(props: Props)  {
    const theme = useTheme()
    const { t } = useTranslation()
    const { open, setOpen} = props

    const styles = {
        dialog: {
            '& .MuiDialog-paper': {
                minWidth: 400,
                backgroundColor: theme.palette.background.paper,
            },
        },
        title: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 2,
        },
        content: {
            padding: 3,
        },
        stepText: {
            marginBottom: 2,
            color: theme.palette.text.primary,
        },
        urlText: {
            color: theme.palette.primary.main,
            textDecoration: 'underline',
            wordBreak: 'break-all',
            marginBottom: 2,
        },
        input: {
            marginTop: 2,
            marginBottom: 3,
            '& .MuiInputBase-root': {
                color: theme.palette.text.primary,
                backgroundColor: theme.palette.background.default,
            },
        },
        spacer: {
            height: 40,
        },
    };

    return (
        <Dialog open={open} scroll="paper" sx={styles.dialog}>
            <Box sx={styles.title}>
                <DialogTitle sx={{ p: 0 }}>{t('Login with Dropbox')}</DialogTitle>
                <IconButton onClick={()=> setOpen(false)}>
                    <CloseIcon />
                </IconButton>
            </Box>

            <Divider />

            <DialogContent sx={styles.content}>
                <Typography variant="body1" sx={styles.stepText}>
                    {t('To allow Chatbox CE to synchronise with Dropbox, please follow the steps below:')}
                </Typography>

                <Typography variant="body1" sx={styles.stepText}>
                    {t('Step 1: Open this URL in your browser to authorise the application:')}
                </Typography>

                <Link
                    component="button"
                    onClick={()=>platform.openLink("https://some.url")}
                    sx={styles.urlText}
                >
                   http://someurl.
                </Link>

                <Typography variant="body1" sx={styles.stepText}>
                    {t('Step 2: Enter the code provided by Dropbox:')}
                </Typography>

                <TextField
                    fullWidth
                    variant="outlined"
                    placeholder={t('Enter code here')}
                    // value={state.authCode}
                    // onChange={handlers.authCodeInput_change}
                    sx={styles.input}
                    InputProps={{
                        style: {
                            color: theme.palette.text.primary,
                        }
                    }}
                />

                <Box sx={styles.spacer} />
            </DialogContent>

            <Divider />

            <DialogActions>
                <Button
                    variant="contained"
                    // onClick={handlers.submit_click}
                    // disabled={state.checkingAuthToken}
                    sx={{ m: 2 }}
                >
                    {t('Submit')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};