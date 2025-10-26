import React from 'react';
import './App.css';
import Block from './Block'
import * as client from './client'
import SessionItem from './SessionItem'
import SortableSessionItem from './SortableSessionItem'
import {
    Toolbar, Box, Badge, Snackbar,
    List, ListSubheader, ListItemText, MenuList,
    IconButton, Button, Stack, Grid, MenuItem, ListItemIcon, Typography, Divider,
    TextField,
} from '@mui/material';
import { Session, createSession, Message, createMessage } from './types'
import ChatIcon from '@mui/icons-material/Chat';
import useStore, { openLink } from './store'
import SettingWindow from './SettingWindow'
import ChatConfigWindow from './ChatConfigWindow'
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import SettingsIcon from '@mui/icons-material/Settings';
import AddIcon from '@mui/icons-material/Add';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import * as prompts from './prompts'
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import CleanWidnow from './CleanWindow';
import { ThemeSwitcherProvider } from './theme/ThemeSwitcher';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';

const { useEffect, useState } = React

function Main() {
    const store = useStore()

    // Drag and drop sensors
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const [activeId, setActiveId] = useState<string | null>(null);
    const [draggedSession, setDraggedSession] = useState<Session | null>(null);

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
        const session = store.chatSessions.find(s => s.id === event.active.id);
        setDraggedSession(session || null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            store.reorderSessions(active.id as string, over.id as string);
        }
        setActiveId(null);
        setDraggedSession(null);
    };

    const handleDragCancel = () => {
        setActiveId(null);
        setDraggedSession(null);
    };

    // 是否展示设置窗口
    const [openSettingWindow, setOpenSettingWindow] = React.useState(false);
    useEffect(() => {
        if (store.needSetting) {
            setOpenSettingWindow(true)
        }
    }, [store.needSetting])

    // 是否展示应用更新提示
    const [needCheckUpdate, setNeedCheckUpdate] = useState(true)

    const [scrollToMsg, setScrollToMsg] = useState<{ msgId: string, smooth?: boolean }>(null)
    useEffect(() => {
        if (!scrollToMsg) {
            return
        }
        const container = document.getElementById('message-list')
        const element = document.getElementById(scrollToMsg.msgId)
        if (!container || !element) {
            return
        }
        const elementRect = element.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const isInsideLeft = elementRect.left >= containerRect.left;
        const isInsideRight = elementRect.right <= containerRect.right;
        const isInsideTop = elementRect.top >= containerRect.top;
        const isInsideBottom = elementRect.bottom <= containerRect.bottom;
        if (isInsideLeft && isInsideRight && isInsideTop && isInsideBottom) {
            return
        }
        // 平滑滚动
        element.scrollIntoView({
            behavior: scrollToMsg.smooth ? 'smooth' : 'auto',
            block: 'end',
            inline: 'nearest',
        })
        setScrollToMsg(null)
    }, [scrollToMsg])

    // 切换到当前会话，自动滚动到最后一条消息
    useEffect(() => {
        if (store.currentSession.messages.length === 0) {
            return
        }
        const last = store.currentSession.messages[store.currentSession.messages.length - 1]
        setScrollToMsg({ msgId: last.id, smooth: false })
    }, [store.currentSession])

    // 会话名称自动生成
    useEffect(() => {
        if (
            store.currentSession.name === 'Untitled'
            && store.currentSession.messages.findIndex(msg => msg.role === 'assistant') !== -1
        ) {
            generateName(store.currentSession)
        }
    }, [store.currentSession.messages])

    const [configureChatConfig, setConfigureChatConfig] = React.useState<Session | null>(null);

    const [sessionClean, setSessionClean] = React.useState<Session | null>(null);

    const generateName = async (session: Session) => {
        client.replay(
            store.settings.openaiKey,
            store.settings.apiHost,
            prompts.nameConversation(session.messages.slice(0, 3)),
            (name) => {
                name = name.replace(/['"“”]/g, '')
                session.name = name
                store.updateChatSession(session)
            },
            (err) => {
                console.log(err)
            }
        )
    }

    const generate = async (session: Session, promptMsgs: Message[], targetMsg: Message) => {
        await client.replay(
            store.settings.openaiKey,
            store.settings.apiHost,
            promptMsgs,
            (text) => {
                for (let i = 0; i < session.messages.length; i++) {
                    if (session.messages[i].id === targetMsg.id) {
                        session.messages[i] = {
                            ...session.messages[i],
                            content: text,
                        }
                        break
                    }
                }
                store.updateChatSession(session)
                setScrollToMsg({ msgId: targetMsg.id, smooth: false })
            },
            (err) => {
                for (let i = 0; i < session.messages.length; i++) {
                    if (session.messages[i].id === targetMsg.id) {
                        session.messages[i] = {
                            ...session.messages[i],
                            content: 'API Request Failed: \n```\n' + err.message + '\n```',
                        }
                        break
                    }
                }
                store.updateChatSession(session)
            }
        )
    }

    const [ messageInput, setMessageInput ] = useState('')
    useEffect(() => {
        document.getElementById('message-input')?.focus() // better way?
    }, [messageInput])

    return (
        <Box sx={{
            height: '100%',
            width: '100%',
        }}>
            <Grid container spacing={2} sx={{
                height: '100%',
            }}>
                <Grid item xs={3}
                    sx={{
                        height: '100%',
                    }}
                >
                    <Stack
                        sx={{
                            height: '100%',
                            padding: '20px 0',
                        }}
                        spacing={2}
                    >
                        <Toolbar variant="dense">
                            <IconButton edge="start" color="inherit" aria-label="menu" sx={{ mr: 2 }}>
                                <ChatIcon />
                            </IconButton>
                            <Typography variant="h5" color="inherit" component="div">
                                ChatBox
                            </Typography>
                        </Toolbar>

                        <Divider />

                        <MenuList
                            sx={{
                                width: '100%',
                                // bgcolor: 'background.paper',
                                position: 'relative',
                                overflow: 'auto',
                                // height: '30vh',
                                height: '60vh',
                                '& ul': { padding: 0 },
                            }}
                            className="scroll"
                            subheader={
                                <ListSubheader component="div">
                                    CHAT
                                </ListSubheader>
                            }
                        >
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragStart={handleDragStart}
                                onDragEnd={handleDragEnd}
                                onDragCancel={handleDragCancel}
                            >
                                <SortableContext
                                    items={store.chatSessions.map(s => s.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    {
                                        store.chatSessions.map((session, ix) => (
                                            <SortableSessionItem
                                                key={session.id}
                                                selected={store.currentSession.id === session.id}
                                                session={session}
                                                switchMe={() => {
                                                    store.switchCurrentSession(session)
                                                    document.getElementById('message-input')?.focus() // better way?
                                                }}
                                                deleteMe={() => store.deleteChatSession(session)}
                                                copyMe={() => {
                                                    const newSession = createSession(session.name + ' Copyed')
                                                    newSession.messages = session.messages
                                                    store.createChatSession(newSession, ix)
                                                }}
                                                editMe={() => setConfigureChatConfig(session)}
                                            />
                                        ))
                                    }
                                </SortableContext>
                                <DragOverlay style={{ cursor: 'grabbing' }}>
                                    {draggedSession ? (
                                        <div style={{ transform: 'rotate(2deg)', boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)' }}>
                                            <SessionItem
                                                session={draggedSession}
                                                selected={false}
                                                switchMe={() => {}}
                                                deleteMe={() => {}}
                                                copyMe={() => {}}
                                                editMe={() => {}}
                                            />
                                        </div>
                                    ) : null}
                                </DragOverlay>
                            </DndContext>
                        </MenuList>

                        <Divider />

                        <MenuItem onClick={() => store.createEmptyChatSession()} >
                            <ListItemIcon>
                                <IconButton><AddIcon fontSize="small" /></IconButton>
                            </ListItemIcon>
                            <ListItemText>
                                New Chat
                            </ListItemText>
                            <Typography variant="body2" color="text.secondary">
                                {/* ⌘N */}
                            </Typography>
                        </MenuItem>
                        <MenuItem onClick={() => {
                            setOpenSettingWindow(true)
                        }}
                        >
                            <ListItemIcon>
                                <IconButton><SettingsIcon fontSize="small" /></IconButton>
                            </ListItemIcon>
                            <ListItemText>
                                Settings
                            </ListItemText>
                            <Typography variant="body2" color="text.secondary">
                                {/* ⌘N */}
                            </Typography>
                        </MenuItem>

                        <MenuItem onClick={() => {
                            setNeedCheckUpdate(false)
                            openLink('https://github.com/Bin-Huang/chatbox/releases')
                        }}>
                            <ListItemIcon>
                                <IconButton>
                                    <InfoOutlinedIcon fontSize="small" />
                                </IconButton>
                            </ListItemIcon>
                            <ListItemText>
                                <Badge color="primary" variant="dot" invisible={!needCheckUpdate} sx={{ paddingRight: '8px' }} >
                                    <Typography color="GrayText">
                                        Version: {store.version}
                                    </Typography>
                                </Badge>
                            </ListItemText>
                        </MenuItem>
                    </Stack>

                </Grid>
                <Grid item xs={9}
                    sx={{
                        height: '100%',
                    }}
                >
                    <Stack sx={{
                        height: '100%',
                        padding: '20px 0',
                    }} spacing={2}>
                        <Toolbar variant="dense">
                            <IconButton edge="start" color="inherit" aria-label="menu" sx={{ mr: 2 }}>
                                <ChatBubbleOutlineOutlinedIcon />
                            </IconButton>
                            <Typography variant="h6" color="inherit" component="div" noWrap sx={{ flexGrow: 1 }}>
                                {store.currentSession.name}
                            </Typography>
                            <IconButton edge="start" color="inherit" aria-label="menu" sx={{ mr: 2 }}
                                onClick={() => setSessionClean(store.currentSession)}
                            >
                                <CleaningServicesIcon />
                            </IconButton>
                        </Toolbar>
                        <Divider />
                        <List
                            id="message-list"
                            className='scroll'
                            sx={{
                                width: '100%',
                                height: '80%',
                                bgcolor: 'background.paper',
                                overflow: 'auto',
                                '& ul': { padding: 0 },
                            }}
                        >
                            {
                                store.currentSession.messages.map((msg, ix) => (
                                    <Block id={msg.id} key={msg.id} msg={msg}
                                        showWordCount={store.settings.showWordCount}
                                        showTokenCount={store.settings.showTokenCount}
                                        setMsg={(updated) => {
                                            store.currentSession.messages = store.currentSession.messages.map((m) => {
                                                if (m.id === updated.id) {
                                                    return updated
                                                }
                                                return m
                                            })
                                            store.updateChatSession(store.currentSession)
                                        }}
                                        delMsg={() => {
                                            store.currentSession.messages = store.currentSession.messages.filter((m) => m.id !== msg.id)
                                            store.updateChatSession(store.currentSession)
                                        }}
                                        refreshMsg={() => {
                                            if (msg.role === 'assistant') {
                                                const promptMsgs = store.currentSession.messages.slice(0, ix)
                                                generate(store.currentSession, promptMsgs, msg)
                                            } else {
                                                const promptsMsgs = store.currentSession.messages.slice(0, ix + 1)
                                                const newAssistantMsg = createMessage('assistant', '....')
                                                const newMessages = [...store.currentSession.messages]
                                                newMessages.splice(ix + 1, 0, newAssistantMsg)
                                                store.currentSession.messages = newMessages
                                                store.updateChatSession(store.currentSession)
                                                generate(store.currentSession, promptsMsgs, newAssistantMsg)
                                                setScrollToMsg({ msgId: newAssistantMsg.id, smooth: true })
                                            }
                                        }}
                                        copyMsg={() => {
                                            navigator.clipboard.writeText(msg.content)
                                            store.addToast('Copied to clipboard')
                                        }}
                                        quoteMsg={() => {
                                            let input = msg.content.split('\n').map(line => `> ${line}`).join('\n')
                                            input += '\n\n-------------------\n\n'
                                            setMessageInput(input)
                                        }}
                                    />
                                ))
                            }
                        </List>
                        <Box>
                            <MessageInput
                                messageInput={messageInput}
                                setMessageInput={setMessageInput}
                                onSubmit={async (newUserMsg: Message) => {
                                    const promptsMsgs = [...store.currentSession.messages, newUserMsg]
                                    const newAssistantMsg = createMessage('assistant', '....')
                                    store.currentSession.messages = [...store.currentSession.messages, newUserMsg, newAssistantMsg]
                                    store.updateChatSession(store.currentSession)
                                    generate(store.currentSession, promptsMsgs, newAssistantMsg)
                                    setScrollToMsg({ msgId: newAssistantMsg.id, smooth: true })
                                }}
                            />
                        </Box>
                    </Stack>
                </Grid>

                <SettingWindow open={openSettingWindow}
                    settings={store.settings}
                    save={(settings) => {
                        store.setSettings(settings)
                        setOpenSettingWindow(false)
                    }}
                    close={() => setOpenSettingWindow(false)}
                />
                {
                    configureChatConfig !== null && (
                        <ChatConfigWindow open={configureChatConfig !== null}
                            session={configureChatConfig}
                            save={(session) => {
                                store.updateChatSession(session)
                                setConfigureChatConfig(null)
                            }}
                            close={() => setConfigureChatConfig(null)}
                        />
                    )
                }
                {
                    sessionClean !== null && (
                        <CleanWidnow open={sessionClean !== null}
                            session={sessionClean}
                            save={(session) => {
                                store.updateChatSession(session)
                                setSessionClean(null)
                            }}
                            close={() => setSessionClean(null)}
                        />
                    )
                }
                {
                    store.toasts.map((toast) => (
                        <Snackbar
                            open
                            onClose={() => store.removeToast(toast.id)}
                            message={toast.content}
                            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                        />
                    ))
                }
            </Grid>
        </Box >
    );
}

export default function App() {
    return (
        <ThemeSwitcherProvider>
            <Main />
        </ThemeSwitcherProvider>
    )
}


function MessageInput(props: {
    onSubmit: (newMsg: Message) => void
    messageInput: string
    setMessageInput: (value: string) => void
}) {
    const {messageInput, setMessageInput} = props
    const submit = (event?: any) => {
        if (event) {
            event.preventDefault()
        }
        const trimmedInput = messageInput.trim()
        if (trimmedInput.length === 0) {
            return
        }
        props.onSubmit(createMessage('user', trimmedInput))
        setMessageInput('')
    }
    return (
        <form onSubmit={submit}>
            <Stack direction="column" spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                        multiline
                        label="Prompt"
                        value={messageInput}
                        onChange={(event) => setMessageInput(event.target.value)}
                        fullWidth
                        maxRows={12}
                        autoFocus
                        id='message-input'
                        onKeyDown={(event) => {
                            if (event.keyCode === 13 && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                                event.preventDefault()
                                submit()
                                return
                            }
                        }}
                    />
                    <Button type='submit' variant="contained" size='large'>
                        SEND
                    </Button>
                </Stack>
                <Typography variant='caption' style={{ opacity: 0.3 }}>[Enter] send, [Shift+Enter] line break</Typography>
            </Stack>
        </form>
    )
}
