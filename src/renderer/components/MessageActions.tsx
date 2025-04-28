import { Message, OpenAICompProviderSettings } from '../../shared/types'
import {
    Stack,
    Typography,
    List,
    ListItem,
    IconButton,
    Paper,
    Divider,
    Box, useTheme, ClickAwayListener
} from '@mui/material'
import {
    CachedRounded,
    InfoOutlined,
    ContentCopy,
    HighlightAlt,
    Edit,
    ArrowForwardIos,
    ArrowBackIosNew,
    Send,
    Close,
} from '@mui/icons-material'
import Tooltip from '@mui/material/Tooltip'
import React, { useMemo } from 'react'
import { countWord } from '@/packages/word-count'
import { estimateTokensFromMessages } from '@/packages/token'
import { copyToClipboard } from '@/packages/navigator'
import * as toastActions from '@/stores/toastActions'
import { useTranslation } from 'react-i18next'
import * as sessionActions from '@/stores/sessionActions'

export interface Props {
    msg: Message
    sessionId: string
    setEditMessage: (show: boolean) => void
    editMessage: boolean
}

export default function MessageActions(props: Props) {

    const {msg, sessionId, setEditMessage} = props

    const theme = useTheme()
    const { t } = useTranslation()
    const [hasChild, setHasChild] = React.useState(false)
    const [numChild, setNumChild] = React.useState(0)
    const [currentChild, setCurrentChild] = React.useState(0)
    const [showMessageInfo, setShowMessageInfo] = React.useState(false)

    useMemo(()=>{
        if (msg.branches && msg.branches.length > 0){
            setNumChild(msg.branches.length)
            setHasChild(true)

            // support the old message which doesn't have numIndex
            setCurrentChild(msg.numIndex? msg.numIndex : 0)
        }
    },[msg])

    const handleRegenerate =  () => {
        sessionActions.regenerateMessage({
            sessionId: sessionId,
            msg: msg,
        })
    }

    const handleNextMessage = (curChild: number) => {

        const promoteTargetBranch = msg.branches?.
        findIndex((element) => {
            // support old message which doesn't have numIndex
            if (typeof element[0].numIndex === 'undefined') return 0 === curChild
            return element[0].numIndex === curChild
        })

         sessionActions.shiftBranch({
             sessionId:sessionId,
             msg: msg,
             promoteBranchIndex: promoteTargetBranch ? promoteTargetBranch : 0,
         })
    }

    const paginationCmp = () => {
        if (!hasChild) {
            return <></>
        }

        return (
            <>
            <Tooltip
                title={"Previous"}
                sx={{
                    backgroundColor: theme.palette.background.paper,
                }}
                arrow
            >
                <span>
                   <IconButton
                       size={"small"}
                       onClick={() => handleNextMessage(currentChild-1)}
                       disabled={currentChild <= 0}
                   >
                    <ArrowBackIosNew fontSize={'inherit'} />
                </IconButton>
                </span>

                </Tooltip>
                <Typography
                    variant="body2"
                    sx={{
                        paddingTop: '5px',
                    }}
                >
                    {currentChild+1}/{numChild+1}
                </Typography>
            <Tooltip
                title={"Next"}
                sx={{
                    backgroundColor: theme.palette.background.paper,
                }}
                arrow
            >
                <span>
                <IconButton
                    size={"small"}
                    onClick={() => handleNextMessage(currentChild+1)}
                    disabled={currentChild >= numChild}
                >
                    <ArrowForwardIos fontSize={'inherit'} />
                </IconButton>
                    </span>
            </Tooltip>
            </>
        )
    }

    if (props.editMessage || props.msg.role === 'system') {
        return (<></>)
    }


    return (
        <Stack direction="row" spacing={0}>
            {paginationCmp()}

            {msg.role !== 'user' ? (
                <Tooltip
                    title={"Regenerate"}
                    sx={{
                        backgroundColor: theme.palette.background.paper,
                    }}
                    arrow
                >
                    <IconButton size="small" onClick={handleRegenerate}>
                        <CachedRounded fontSize={'inherit'} />
                    </IconButton>
                </Tooltip>
            ) : (
                <Tooltip
                    title={"Edit"}
                    sx={{
                        backgroundColor: theme.palette.background.paper,
                    }}
                    arrow
                >
                    <IconButton size="small" onClick={()=> setEditMessage(true)}>
                        <Edit fontSize={'inherit'} />
                    </IconButton>
                </Tooltip>
            )}

            <Tooltip
                title={"Copy"}
                sx={{
                    backgroundColor: theme.palette.background.paper,
                }}
                arrow
            >
                <IconButton
                size="small"
                onClick={() => {
                    copyToClipboard(msg.content);
                    toastActions.add(t('copied to clipboard'));
                }}
            >
                <ContentCopy fontSize={'inherit'} />
                </IconButton>
            </Tooltip>
            <ClickAwayListener onClickAway={()=> setShowMessageInfo(false)}>
            <Tooltip
                open={showMessageInfo}
                title={<KeyValueList msg={msg} />}
                sx={{
                    backgroundColor: theme.palette.background.paper,
                }}
                arrow
                disableFocusListener
                disableTouchListener
                onMouseEnter={() => setShowMessageInfo(true)}
                onMouseLeave={() => setShowMessageInfo(false)}
            >
                <IconButton 
                    size="small" 
                    onClick={() => setShowMessageInfo(!showMessageInfo)}
                >
                    <InfoOutlined fontSize={'inherit'} />
                </IconButton>
            </Tooltip>
            </ClickAwayListener>
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
    ];

    if (msg.model !== undefined || msg.model === "") {
        entries.push({
            key: 'Model',
            value: msg.model || 'Unknown' as any
        })
    }

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