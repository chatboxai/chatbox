import { MutableRefObject } from 'react'
import SessionItem from './SessionItem'
import * as atoms from '../stores/atoms'
import { useAtomValue, useSetAtom } from 'jotai'
import type { DragEndEvent } from '@dnd-kit/core'
import { MenuList } from '@mui/material'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
    DndContext,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    closestCenter,
    useSensor,
    useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'

export interface Props {
    sessionListRef: MutableRefObject<HTMLDivElement | null>
}

export default function SessionList(props: Props) {
    const sortedSessions = useAtomValue(atoms.sortedSessionsAtom)
    const setSessions = useSetAtom(atoms.sessionsAtom)
    const currentSessionId = useAtomValue(atoms.currentSessionIdAtom)
    const sensors = useSensors(
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 250,
                tolerance: 10,
            },
        }),
        useSensor(MouseSensor, {
            activationConstraint: {
                distance: 10,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    const onDragEnd = (event: DragEndEvent) => {
        if (!event.over) {
            return
        }
        const activeId = event.active.id
        const overId = event.over.id
        if (activeId !== overId) {
            const oldIndex = sortedSessions.findIndex(s => s.id === activeId)
            const newIndex = sortedSessions.findIndex(s => s.id === overId)
            const newReversed = arrayMove(sortedSessions, oldIndex, newIndex)
            setSessions(atoms.sortSessions(newReversed))
        }
    }
    return (
        <MenuList
            sx={{
                width: '100%',
                overflow: 'auto',
                '& ul': { padding: 0 },
                flexGrow: 1,
            }}
            component="div"
            ref={props.sessionListRef}
        >
            <DndContext
                modifiers={[restrictToVerticalAxis]}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
            >
                <SortableContext items={sortedSessions} strategy={verticalListSortingStrategy}>
                    {sortedSessions.map((session, ix) => (
                        <SortableItem key={session.id} id={session.id}>
                            <SessionItem
                                key={session.id}
                                selected={currentSessionId === session.id}
                                session={session}
                            />
                        </SortableItem>
                    ))}
                </SortableContext>
            </DndContext>
        </MenuList>
    )
}

function SortableItem(props: {
    id: string
    children?: React.ReactNode
}) {
    const { id, children } = props
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
            }}
            {...attributes}
            {...listeners}
        >
            {children}
        </div>
    )
}
