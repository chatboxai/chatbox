import { useEffect, useRef } from 'react'
import Message from './Message'
import * as atoms from '../stores/atoms'
import { useAtom, useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'

interface Props { }

export default function MessageList(props: Props) {
    const currentSession = useAtomValue(atoms.currentSessionAtom)
    const currentMessageList = useAtomValue(atoms.currentMessageListAtom)
    const ref = useRef<HTMLDivElement | null>(null)
    const [, setMessageListRef] = useAtom(atoms.messageListRefAtom)

    useEffect(() => {
        setMessageListRef(ref)
    }, [ref])
    return (
            <div className='overflow-y-auto w-full h-full pr-0 pl-0' ref={ref}>
                {
                    currentMessageList.map((msg, index) => (
                        <Message
                            id={msg.id}
                            key={'msg-' + msg.id}
                            msg={msg}
                            sessionId={currentSession.id}
                            sessionType={currentSession.type || 'chat'}
                            className={index === 0 ? 'pt-4' : ''}
                            collapseThreshold={msg.role === 'system' ? 150 : undefined}
                        />
                    ))
                }
            </div>
    )
}