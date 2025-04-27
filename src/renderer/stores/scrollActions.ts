import { getDefaultStore } from 'jotai'
import * as atoms from './atoms'

export function scrollToBottom(behavior: 'auto' | 'smooth' = 'auto') {
    const store = getDefaultStore()
    const messageListRef = store.get(atoms.messageListRefAtom)
    if (messageListRef && messageListRef.current) {
        messageListRef?.current?.scrollToIndex({
            index: 'LAST',
            align: 'end',
            behavior: behavior,
        })
        // messageListRef.current.scrollTo({
        //     top: messageListRef.current.scrollHeight,
        //     behavior,
        // })
    }
}
