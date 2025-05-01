import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Box,
    ListItemText,
    MenuList,
    IconButton,
    Stack,
    MenuItem,
    ListItemIcon,
    Typography,
    Divider,
    useTheme,
    SwipeableDrawer,
} from '@mui/material'
import {
    CloudSync
} from '@mui/icons-material';
import SettingsIcon from '@mui/icons-material/Settings'
import { useTranslation } from 'react-i18next'
import icon from './static/icon.png'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import useVersion from './hooks/useVersion'
import SessionList from './components/SessionList'
import { useAtom } from 'jotai/index'
import platform from '@/packages/platform'
import CircularProgress from '@mui/material/CircularProgress'
import { synchronizeErrorMessage, synchronizeShowLoading } from './stores/atoms'

export const drawerWidth = 240

interface Props {
    openCopilotWindow(): void
    openAboutWindow(): void
    setOpenSettingWindow(name: 'ai' | 'display' | null): void
    toggleSidebar(newOpen: boolean): void
    sidebarOpen: boolean
}

export default function Sidebar(props: Props) {
    const { t } = useTranslation()
    const versionHook = useVersion()
    const [isMobile, setIsMobile] = useState<boolean>(false)
    const sessionListRef = useRef<HTMLDivElement>(null)
    const theme = useTheme()
    const [loading,] = useAtom(synchronizeShowLoading);
    const [, setSyncErrMsg] = useAtom(synchronizeErrorMessage);

    useEffect(() => {
        platform.isMobile().then(setIsMobile)
    }, [])

    const handleSync = async () => {
        try {
            await platform.executeSync()
        }catch (e: any) {
            setSyncErrMsg(e)
        }
    }

    return (
        <SwipeableDrawer
            open={props.sidebarOpen}
            onClose={() => {
                props.toggleSidebar(false)
            }}
            onOpen={() => {
                props.toggleSidebar(true)
            }}
            className="fixed top-0 left-0 h-full z-50"
            style={{
                boxSizing: 'border-box',
                width: drawerWidth,
                borderRightWidth: '1px',
                borderRightStyle: 'solid',
                borderRightColor: theme.palette.divider,
            }}
            disableDiscovery={true}
            swipeAreaWidth={isMobile ? 0 : 0}
            slotProps={{
                backdrop: sessionListRef,
            }}
        >
            <div className="ToolBar h-full">
                <Stack
                    className="pt-3 pl-2 pr-1"
                    sx={{
                        height: '100%',
                    }}
                >
                    <Box className="flex justify-between items-center px-2">
                        <Box>
                            <a
                                target="_blank"
                                className="flex items-center no-underline"
                            >
                                <img src={icon} className="w-8 h-8 mr-3" />
                                <div className="flex flex-col items-start">
                                    <span className="text-2xl font-medium">Cha</span>
                                    <span className="text-[10px] opacity-50">Your chat AI assistant</span>
                                </div>
                            </a>
                        </Box>
                    </Box>

                    <SessionList sessionListRef={sessionListRef} />

                    <Divider variant="fullWidth" />

                    <MenuList sx={{ marginBottom: '20px' }}>
                        <MenuItem onClick={props.openCopilotWindow} sx={{ padding: '0.2rem 0.1rem', margin: '0.1rem' }}>
                            <ListItemIcon>
                                <IconButton>
                                    <SmartToyIcon fontSize="small" />
                                </IconButton>
                            </ListItemIcon>
                            <ListItemText>
                                <Typography>{t('My Copilots')}</Typography>
                            </ListItemText>
                        </MenuItem>

                        <MenuItem
                            onClick={() => {
                                props.setOpenSettingWindow('ai')
                            }}
                            sx={{ padding: '0.2rem 0.1rem', margin: '0.1rem' }}
                        >
                            <ListItemIcon>
                                <IconButton>
                                    <SettingsIcon fontSize="small" />
                                </IconButton>
                            </ListItemIcon>
                            <ListItemText>{t('settings')}</ListItemText>
                            <Typography variant="body2" color="text.secondary">
                                {/* ⌘N */}
                            </Typography>
                        </MenuItem>

                        <MenuItem sx={{ padding: '0.2rem 0.1rem', margin: '0.1rem' }} onClick={handleSync}>
                            <ListItemIcon>
                                <IconButton>
                                    <CloudSync fontSize="small" />
                                </IconButton>
                            </ListItemIcon>
                            <ListItemText>{t('Synchronise')}</ListItemText>
                            {loading && (
                                <ListItemIcon>
                                    <CircularProgress size="20px" color="inherit" />
                                </ListItemIcon>
                            )}
                        </MenuItem>

                        {/*<MenuItem onClick={props.openAboutWindow} sx={{ padding: '0.2rem 0.1rem', margin: '0.1rem' }}>*/}
                        {/*    <ListItemIcon>*/}
                        {/*        <IconButton>*/}
                        {/*            <InfoOutlinedIcon fontSize="small" />*/}
                        {/*        </IconButton>*/}
                        {/*    </ListItemIcon>*/}
                        {/*    <ListItemText>*/}
                        {/*        <Badge*/}
                        {/*            color="primary"*/}
                        {/*            variant="dot"*/}
                        {/*            invisible={!versionHook.needCheckUpdate}*/}
                        {/*            sx={{ paddingRight: '8px' }}*/}
                        {/*        >*/}
                        {/*            <Typography sx={{ opacity: 0.5 }}>*/}
                        {/*                {t('About')}*/}
                        {/*                {/\d/.test(versionHook.version) ? `(${versionHook.version})` : ''}*/}
                        {/*            </Typography>*/}
                        {/*        </Badge>*/}
                        {/*    </ListItemText>*/}
                        {/*</MenuItem>*/}
                    </MenuList>
                </Stack>
            </div>
        </SwipeableDrawer>
    )
}
