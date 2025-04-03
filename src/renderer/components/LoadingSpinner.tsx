import CircularProgress from '@mui/material/CircularProgress'

export interface Props {
    speed: number
    size?: string
}
export default function LoadingSpinner(props: Props) {
    return (
        <CircularProgress size={props.size || 'inherit'} color={'inherit'} />
    );
}