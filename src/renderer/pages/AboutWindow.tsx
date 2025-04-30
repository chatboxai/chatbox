import {
    Button,
    Paper,
    Badge,
    Box,
    Dialog,
    DialogContent,
    DialogActions,
    DialogTitle,
    useTheme,
} from '@mui/material'
import iconPNG from '../static/icon.png'
import { useTranslation } from 'react-i18next'
import platform from '../packages/platform'
import useVersion from '../hooks/useVersion'
import * as atoms from '../stores/atoms'
import { useAtomValue } from 'jotai'

interface Props {
    open: boolean
    close(): void
}

export default function AboutWindow(props: Props) {
    const { t } = useTranslation()
    const theme = useTheme()
    const language = useAtomValue(atoms.languageAtom)
    const versionHook = useVersion()
    return (
        <Dialog open={props.open} onClose={props.close} fullWidth>
            <DialogTitle>{t('About Cha')}</DialogTitle>
            <DialogContent>
                <Box sx={{ textAlign: 'center', padding: '0 20px' }}>
                    <img src={iconPNG} style={{ width: '100px', margin: 0, display: 'inline-block' }} />
                    <h3 style={{ margin: '4px 0 5px 0' }}>Cha
                        {
                            /\d/.test(versionHook.version)
                                ? `(v${versionHook.version})`
                                : ''
                        }
                    </h3>
                    <p className="p-0 m-0">{t('about-slogan')}</p>
                    <p className="p-0 m-0 opacity-60 text-xs">{t('about-introduction')}</p>
                </Box>
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                    }}
                    className='mt-1'
                >
                    <Badge color="primary" variant="dot" invisible={!versionHook.needCheckUpdate}
                        sx={{ margin: '4px' }}
                    >
                        <Button
                            variant="outlined"
                        >
                            {t('Check Update')}
                        </Button>
                    </Badge>
                    <Button
                        variant="outlined"
                        sx={{ margin: '4px' }}
                    >
                        {t('Homepage')}
                    </Button>
                    <Button
                        variant="outlined"
                        sx={{ margin: '4px' }}
                    >
                        {t('Feedback')}
                    </Button>
                    <Button
                        variant="outlined"
                        sx={{ margin: '4px' }}
                    >
                        {t('FAQs')}
                    </Button>
                </Box>
                <Paper
                    elevation={2}
                    className="font-light text-xs m-2 py-1 px-4"
                    sx={{
                        backgroundColor: 'paper',
                    }}
                >
                    <div className='my-1'>
                        <b>Benn:</b>
                    </div>
                    <div className='my-1'>
                        <span>{t('Auther Message')}</span>
                    </div>
                    <div className='my-1'>
                        <a
                            className='underline font-normal cursor-pointer mr-4' style={{ color: theme.palette.primary.main }}
                        >
                            {t('Donate')}
                        </a>
                        <a
                            className='underline font-normal cursor-pointer mr-4' style={{ color: theme.palette.primary.main }}
                        >
                            {t('Follow me on Twitter(X)')}
                        </a>
                    </div>
                </Paper>
            </DialogContent>
            <DialogActions>
                <Button onClick={props.close}>{t('close')}</Button>
            </DialogActions>
        </Dialog>
    )
}
