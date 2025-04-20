import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    Link,
    TextField,
    Typography,
    useTheme,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { useTranslation } from 'react-i18next'
import React, { useEffect, useState } from 'react'
import platform from '../../packages/platform'
import { dropbox } from '@/packages/synchronization/dropbox'
import { useAtom } from 'jotai/index'
import { settingsAtom } from '@/stores/atoms'
import Alert from '@mui/material/Alert'

interface Props {
    open: boolean
    setOpen: (open: boolean) => void
}
export default  function  DropboxLogin(props: Props) {
    const theme = useTheme()
    const { t } = useTranslation()
    const { open, setOpen } = props

    const [settingsEdit, setSettingsEdit] = useAtom(settingsAtom)
    const [authCode, setAuthCode] = useState<string>('')
    const [errorMessage, setErrorMessage] = useState<string>('')

    const [loginURL, setLoginURL] = useState<string>('');

    useEffect(() => {
        const fetchURL = async () => {
            const url = await platform.getDropboxLoginURL();
            setLoginURL(url);
        };
        fetchURL();
    }, []);


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


    const handleSubmit= async () =>  {
        setErrorMessage('')
        try {

            const authToken = await platform.getDropboxAuthToken(authCode)

            if (authToken === "") {
                return
            }

            settingsEdit.syncConfig = {
                ...settingsEdit.syncConfig,
                providersConfig: {
                    ...(settingsEdit.syncConfig?.providersConfig || {}),
                    Dropbox: {
                        ...(settingsEdit.syncConfig?.providersConfig?.Dropbox || {}),
                        authToken: authToken
                    }
                }
            };

            setSettingsEdit(settingsEdit);

            setOpen(false)
        }catch (e) {
            setErrorMessage(e)
        }
    }

    const handleOnClose = () => {
        setErrorMessage('')
        setOpen(false)
    }

    console.log(settingsEdit.syncConfig)

    return (
        <Dialog open={open} onClose={()=> handleOnClose()} scroll="paper" sx={styles.dialog}>
            <Box sx={styles.title}>
                <DialogTitle sx={{ p: 0 }}>{t('Login with Dropbox')}</DialogTitle>
                <IconButton onClick={() => handleOnClose()}>
                    <CloseIcon />
                </IconButton>
            </Box>

            <Divider />

            <DialogContent sx={styles.content}>
                {errorMessage !== '' && (
                    <Alert icon={false} severity="error">
                        {errorMessage}
                    </Alert>
                )}

                <Typography variant="body1" sx={styles.stepText}>
                    {t('To allow Chatbox CE to synchronise with Dropbox, please follow the steps below:')}
                </Typography>

                <Typography variant="body1" sx={styles.stepText}>
                    {t('Step 1: Open this URL in your browser to authorise the application:')}
                </Typography>

                <Link
                    component="button"
                    onClick={() => platform.openLink(`${loginURL}`)}
                    sx={styles.urlText}
                >
                    {loginURL}
                </Link>

                <Typography variant="body1" sx={styles.stepText}>
                    {t('Step 2: Enter the code provided by Dropbox:')}
                </Typography>

                <TextField
                    fullWidth
                    variant="outlined"
                    placeholder={t('Enter code here')}
                    value={authCode}
                    onChange={(e ) => setAuthCode(e.target.value)}
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
                    onClick={handleSubmit}
                    // disabled={state.checkingAuthToken}
                    sx={{ m: 2 }}
                >
                    {t('Submit')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

function async() {
    throw new Error('Function not implemented.')
}
