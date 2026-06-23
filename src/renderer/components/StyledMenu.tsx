import { Menu, type MenuProps } from '@mui/material'
import 'katex/dist/katex.min.css'
import { alpha, styled } from '@mui/material/styles'
import { useLanguage } from '@/stores/settingsStore'
import { isRtlLanguage } from '@/i18n/rtl'

const StyledMenu = styled((props: MenuProps) => {
  const language = useLanguage()
  return (
    <Menu
      dir={isRtlLanguage(language) ? 'rtl' : 'ltr'}
      elevation={0}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'right',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      PopoverClasses={{
        root: '',
        paper: '',
      }}
      {...props}
    />
  )
})(({ theme }) => ({
  '& .MuiPaper-root': {
    backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[100],
    borderRadius: 6,
    marginTop: theme.spacing(1),
    minWidth: 140,
    color: theme.palette.mode === 'light' ? 'rgb(55, 65, 81)' : theme.palette.grey[300],
    boxShadow:
      'rgb(255, 255, 255) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgba(0, 0, 0, 0.05) 0px 4px 6px -2px',
    '& .MuiMenu-list': {
      padding: '0px 0',
    },
    '& .MuiMenuItem-root': {
      padding: '8px',
      '& .MuiSvgIcon-root': {
        color: theme.palette.text.secondary,
        marginRight: theme.spacing(1.5),
      },
      '&:active': {
        backgroundColor: alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity),
      },
    },
    '& hr': {
      margin: '2px 0',
    },
  },
  '& .MuiPaper-root::-webkit-scrollbar': {
    width: '6px',
  },
  '& .MuiPaper-root::-webkit-scrollbar-track': {
    background: 'transparent',
  },
  '& .MuiPaper-root::-webkit-scrollbar-thumb': {
    backgroundColor: theme.palette.mode === 'light' ? '#0000001a' : '#ffffff1a',
    borderRadius: '4px',
  },
  '& .MuiPaper-root::-webkit-scrollbar-thumb:hover': {
    backgroundColor: theme.palette.mode === 'light' ? '#0000003a' : '#ffffff3a',
  },
}))

export default StyledMenu
