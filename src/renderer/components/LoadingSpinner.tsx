import { keyframes } from '@emotion/react'
import { Refresh } from '@mui/icons-material';
import { useTheme } from '@mui/material'

export interface Props {
    speed: number
    size?: string
}
export default function LoadingSpinner(props: Props) {
    const theme = useTheme()
    const spin = keyframes`
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
`;

    return (
        <Refresh
            sx={{
                animation: `${spin} ${props.speed}s linear infinite`,
                fontSize: props.size || 'inherit',
                color: theme.palette.grey[500],
            }}
        />
    );
}