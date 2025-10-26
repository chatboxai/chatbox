import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SessionItem from './SessionItem';
import { Session } from './types';

interface SortableSessionItemProps {
    session: Session
    selected: boolean
    switchMe: () => void
    deleteMe: () => void
    copyMe: () => void
    editMe: () => void
}

export default function SortableSessionItem(props: SortableSessionItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: props.session.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style}>
            <SessionItem 
                {...props}
                dragHandleProps={isDragging ? undefined : { ...attributes, ...listeners }}
                isDragging={isDragging}
            />
        </div>
    );
}

