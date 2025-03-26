import { Chip, MenuItem, Typography } from '@mui/material'
import { ModelProvider, ModelSettings } from '../../shared/types'
import { useTranslation } from 'react-i18next'
import { AIModelProviderMenuOptionList } from '../packages/models'
import * as React from 'react';
import Button from '@mui/material/Button';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import StyledMenu from './StyledMenu';
import StarIcon from '@mui/icons-material/Star';

interface ModelConfigProps {
    settings: ModelSettings
    setSettings(value: ModelSettings): void
    className?: string
    hideCustomProviderManage?: boolean
}

export default function AIProviderSelect(props: ModelConfigProps) {
    const { settings, setSettings, className, hideCustomProviderManage } = props
    const { t } = useTranslation()

    const [menuAnchorEl, setMenuAnchorEl] = React.useState<null | HTMLElement>(null);
    const menuState = Boolean(menuAnchorEl);
    const openMenu = (event: React.MouseEvent<HTMLElement>) => {
        setMenuAnchorEl(event.currentTarget);
    };
    const closeMenu = () => {
        setMenuAnchorEl(null);
    };

    return (
        <>
            <Typography variant='caption' className='opacity-50'>
                {t('Model Provider')}:
            </Typography>
            <div className='flex items-end justify-between'>
                <Button
                    variant="contained"
                    disableElevation
                    onClick={openMenu}
                    endIcon={<KeyboardArrowDownIcon />}
                >
                    <Typography className='text-left' maxWidth={200} noWrap>
                        { AIModelProviderMenuOptionList.find((provider) => provider.value === settings.aiProvider)?.label || 'Unknown' }
                    </Typography>
                </Button>
                <StyledMenu
                    anchorEl={menuAnchorEl}
                    open={menuState}
                    onClose={closeMenu}
                    anchorOrigin={{
                        vertical: 'bottom',
                        horizontal: 'left',
                    }}
                    transformOrigin={{
                        vertical: 'top',
                        horizontal: 'left',
                    }}
                >
                    {
                        AIModelProviderMenuOptionList.map((provider) => (
                            <MenuItem key={provider.value} disableRipple
                                onClick={() => {
                                    setSettings({
                                        ...settings,
                                        aiProvider: provider.value as ModelProvider,
                                    })
                                    closeMenu()
                                }}
                            >
                                <StarIcon />
                                {provider.label}
                                {provider.featured && (
                                    <Chip
                                        label={t('Easy Access')}
                                        size="small"
                                        color="success"
                                        variant="outlined"
                                        sx={{ marginLeft: '10px' }}
                                    />
                                )}
                            </MenuItem>
                        ))
                    }
                </StyledMenu>
            </div>
        </>
    )
}

