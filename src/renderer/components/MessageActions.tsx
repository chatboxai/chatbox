import { Message  } from '../../shared/types'
import {
    Stack,
    Typography,
    List,
    ListItem,
    IconButton,
    Paper,
    Divider,
    Box, useTheme
} from '@mui/material'
import { CachedRounded, InfoOutlined,ContentCopy,HighlightAlt,Edit } from '@mui/icons-material'
import Tooltip from '@mui/material/Tooltip'
import React from 'react'
import { countWord } from '@/packages/word-count'
import { estimateTokensFromMessages } from '@/packages/token'
import { copyToClipboard } from '@/packages/navigator'
import * as toastActions from '@/stores/toastActions'
import { useTranslation } from 'react-i18next'

export interface Props {
    msg: Message
}

export default function MessageActions(props: Props) {
    const theme = useTheme()
    const { t } = useTranslation()

    return (
        <Stack direction="row" spacing={0}>
            {props.msg.role !== 'user' ? (
                <IconButton size="small">
                    <CachedRounded fontSize={'inherit'} />
                </IconButton>
            ) : (
                <IconButton size="small">
                    <Edit fontSize={'inherit'} />
                </IconButton>
            )}

            <IconButton
                size="small"
                onClick={() => {
                    copyToClipboard(props.msg.content);
                    toastActions.add(t('copied to clipboard'));
                }}
            >
                <ContentCopy fontSize={'inherit'} />
            </IconButton>

            <IconButton size="small">
                <HighlightAlt fontSize={'inherit'} />
            </IconButton>

            <Tooltip
                title={<KeyValueList msg={props.msg} />}
                sx={{
                    backgroundColor: theme.palette.background.paper,
                }}
                arrow
            >
                <IconButton size="small">
                    <InfoOutlined fontSize={'inherit'} />
                </IconButton>
            </Tooltip>
        </Stack>
    );
}
interface KeyValueListProps {
    msg: Message;
}
const KeyValueList = ({ msg }: KeyValueListProps) => {
    const theme = useTheme()

    const entries = [
        {
            key: 'Word Count',
            value: msg.wordCount ?? countWord(msg.content)
        },
        {
            key: 'Token Count',
            value: msg.tokenCount ?? estimateTokensFromMessages([msg])
        },
        {
            key: 'Tokens Used',
            value: msg.tokensUsed ?? 0
        },
        {
            key: 'Model',
            value: msg.model || 'Unknown'
        }
    ];

    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
        }}>
            {entries.map((entry) => (
                <Box
                    key={entry.key}
                    sx={{
                        display: 'flex',
                        gap: 1,
                        alignItems: 'baseline',
                        lineHeight: 1.2
                    }}
                >
                    <Typography
                        variant="caption"
                        sx={{
                            fontWeight: 500,
                            minWidth: '80px',
                            textAlign: 'right'
                        }}
                    >
                        {entry.key}
                    </Typography>
                    <Typography
                        variant="caption"
                        sx={{
                            wordBreak: 'break-word',
                            flexGrow: 1
                        }}
                    >
                        {entry.value}
                    </Typography>
                </Box>
            ))}
        </Box>
    );
};