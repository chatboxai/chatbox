import {
  applyChatBridgeChessMove,
  createChatBridgeChessGame,
  getChatBridgeChessLegalMoves,
  getChatBridgeChessStatusText,
  normalizeChatBridgeChessRuntimeSnapshot,
  undoChatBridgeChessMove,
  type ChatBridgeChessRuntimeSnapshot,
  type ChatBridgeChessRuntimeStatus,
  type ChatBridgeChessRuntimeMove,
  type ChatBridgeChessRuntimeFeedback,
} from '@shared/chatbridge'
import type { MessageAppPart } from '@shared/types'
import type { Piece, Square } from 'chess.js'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

interface ChessRuntimeProps {
  part: MessageAppPart
  onUpdatePart?: (nextPart: MessageAppPart) => void
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const

const PIECE_GLYPHS: Record<'w' | 'b', Record<Piece['type'], string>> = {
  w: {
    p: '♙',
    n: '♘',
    b: '♗',
    r: '♖',
    q: '♕',
    k: '♔',
  },
  b: {
    p: '♟',
    n: '♞',
    b: '♝',
    r: '♜',
    q: '♛',
    k: '♚',
  },
}

const PIECE_NAMES: Record<Piece['type'], string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

function isTerminalStatus(status: ChatBridgeChessRuntimeSnapshot['boardContext']['positionStatus']) {
  return status === 'checkmate' || status === 'stalemate' || status === 'draw'
}

function buildSquareLabel(
  square: Square,
  piece: Piece | undefined,
  options: { selected: boolean; legalTarget: boolean }
) {
  if (!piece) {
    if (options.legalTarget) {
      return `${square}, legal destination`
    }
    return `${square}, empty square`
  }

  return `${square}, ${piece.color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[piece.type]}${
    options.selected ? ', selected' : ''
  }${options.legalTarget ? ', legal destination' : ''}`
}

function getSnapshotFeedback(snapshot: ChatBridgeChessRuntimeSnapshot): ChatBridgeChessRuntimeFeedback {
  return (
    snapshot.feedback ?? {
      kind: 'info',
      title: 'Host-owned runtime',
      message:
        'Select a piece, then choose a legal destination. Accepted or rejected moves stay persisted in this app message.',
    }
  )
}

function buildPartFromSnapshot(part: MessageAppPart, snapshot: ChatBridgeChessRuntimeSnapshot): MessageAppPart {
  const statusText = snapshot.status === 'stale' ? 'Stale board' : getChatBridgeChessStatusText(snapshot)
  const description =
    part.description ??
    'Moves validate inside the board first, then emit a structured host update for the same conversation block.'

  return {
    ...part,
    appName: part.appName ?? 'Chess',
    title: part.title ?? 'Chess runtime',
    description,
    summary: snapshot.boardContext.summary,
    statusText,
    snapshot,
  }
}

function updateSnapshotStatus(snapshot: ChatBridgeChessRuntimeSnapshot, status: ChatBridgeChessRuntimeStatus) {
  return normalizeChatBridgeChessRuntimeSnapshot({
    ...snapshot,
    status,
  })
}

function buildExplainFeedback(snapshot: ChatBridgeChessRuntimeSnapshot) {
  return normalizeChatBridgeChessRuntimeSnapshot({
    ...snapshot,
    feedback: {
      kind: 'info',
      title: 'Host snapshot',
      message: snapshot.boardContext.summary ?? 'The host owns the current chess position summary for this thread.',
    },
  })
}

export function ChessRuntime({ part, onUpdatePart }: ChessRuntimeProps) {
  const snapshot = useMemo(() => normalizeChatBridgeChessRuntimeSnapshot(part.snapshot), [part.snapshot])
  const game = useMemo(() => createChatBridgeChessGame(snapshot), [snapshot])
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)

  useEffect(() => {
    setSelectedSquare(null)
  }, [snapshot.boardContext.fen])

  const activeTurn = snapshot.boardContext.sideToMove === 'white' ? 'w' : 'b'
  const selectedPiece = selectedSquare ? game.get(selectedSquare) : undefined
  const legalMoves = useMemo(
    () => (selectedSquare ? getChatBridgeChessLegalMoves(snapshot, selectedSquare) : []),
    [selectedSquare, snapshot]
  )
  const legalTargets = useMemo(() => new Set(legalMoves.map((move) => move.to)), [legalMoves])
  const lastMoveSquares = useMemo(() => {
    const uci = snapshot.boardContext.lastMove?.uci
    if (!uci || uci.length < 4) {
      return new Set<string>()
    }
    return new Set([uci.slice(0, 2), uci.slice(2, 4)])
  }, [snapshot.boardContext.lastMove?.uci])
  const feedback = getSnapshotFeedback(snapshot)

  const interactionsDisabled =
    part.lifecycle !== 'active' || snapshot.status === 'stale' || isTerminalStatus(snapshot.boardContext.positionStatus)

  function commitSnapshot(nextSnapshot: ChatBridgeChessRuntimeSnapshot) {
    onUpdatePart?.(buildPartFromSnapshot(part, nextSnapshot))
  }

  function handleExplainPosition() {
    commitSnapshot(buildExplainFeedback(snapshot))
  }

  function handleUndo() {
    if (!onUpdatePart) {
      return
    }

    const next = undoChatBridgeChessMove(snapshot)
    setSelectedSquare(null)
    commitSnapshot(updateSnapshotStatus(next.snapshot, snapshot.status))
  }

  function handleSquarePress(square: Square) {
    if (interactionsDisabled) {
      return
    }

    const piece = game.get(square)

    if (!selectedSquare) {
      if (!piece || piece.color !== activeTurn) {
        commitSnapshot(
          normalizeChatBridgeChessRuntimeSnapshot({
            ...snapshot,
            feedback: {
              kind: 'rejected',
              title: 'Select a movable piece',
              message: `${capitalize(snapshot.boardContext.sideToMove)} must choose one of their own pieces before making a move.`,
            },
          })
        )
        return
      }

      if (getChatBridgeChessLegalMoves(snapshot, square).length === 0) {
        commitSnapshot(
          normalizeChatBridgeChessRuntimeSnapshot({
            ...snapshot,
            feedback: {
              kind: 'rejected',
              title: 'No legal moves',
              message: `${capitalize(snapshot.boardContext.sideToMove)} cannot move the piece on ${square} from the current host-owned board state.`,
            },
          })
        )
        return
      }

      setSelectedSquare(square)
      return
    }

    if (selectedSquare === square) {
      setSelectedSquare(null)
      return
    }

    if (piece && piece.color === activeTurn) {
      setSelectedSquare(square)
      return
    }

    const result = applyChatBridgeChessMove(snapshot, { from: selectedSquare, to: square })

    if (!result.accepted) {
      commitSnapshot(result.snapshot)
      return
    }

    setSelectedSquare(null)
    commitSnapshot(result.snapshot)
  }

  const boardRows = game.board()

  return (
    <div className="rounded-[20px] bg-chatbox-background-primary p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-chatbox-border-primary pb-3">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {snapshot.status === 'stale' ? 'Stale board' : getChatBridgeChessStatusText(snapshot)}
          </span>
          <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-[11px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            Legal moves {snapshot.boardContext.legalMovesCount ?? 0}
          </span>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-chatbox-tertiary">
          Session-linked runtime
        </span>
      </div>

      <div className="mt-4 rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
        <div className="mx-auto grid max-w-[28rem] grid-cols-8 gap-1">
          {boardRows.map((rank, rankIndex) =>
            rank.map((piece, fileIndex) => {
              const square = `${FILES[fileIndex]}${8 - rankIndex}` as Square
              const isLight = (rankIndex + fileIndex) % 2 === 0
              const isSelected = selectedSquare === square
              const isLegalTarget = legalTargets.has(square)
              const isLastMove = lastMoveSquares.has(square)

              return (
                <button
                  key={square}
                  type="button"
                  aria-label={buildSquareLabel(square, piece ?? undefined, {
                    selected: isSelected,
                    legalTarget: isLegalTarget,
                  })}
                  className={cn(
                    'relative aspect-square rounded-[10px] border text-2xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chatbox-tint-brand/70',
                    isLight
                      ? 'bg-sky-50 text-slate-900 dark:bg-sky-950/40 dark:text-slate-50'
                      : 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-50',
                    isSelected && 'border-blue-500 ring-2 ring-blue-500/40',
                    !isSelected && isLastMove && 'border-blue-300',
                    !isSelected && !isLastMove && 'border-transparent',
                    !interactionsDisabled && 'hover:brightness-[0.96]'
                  )}
                  onClick={() => handleSquarePress(square)}
                  disabled={interactionsDisabled}
                >
                  {piece ? (
                    <span aria-hidden="true">{PIECE_GLYPHS[piece.color][piece.type]}</span>
                  ) : isLegalTarget ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 flex items-center justify-center text-blue-600 dark:text-blue-300"
                    >
                      •
                    </span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="min-w-28 rounded-full border border-chatbox-border-primary bg-chatbox-background-primary px-4 py-2 text-sm font-semibold text-chatbox-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleUndo}
            disabled={snapshot.moveHistory.length === 0}
          >
            Undo
          </button>
          <button
            type="button"
            className="min-w-32 rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleExplainPosition}
          >
            Explain position
          </button>
        </div>

        <p className="mt-3 text-center text-xs text-chatbox-tertiary">
          {selectedPiece && selectedSquare
            ? `Selected ${selectedPiece.color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[selectedPiece.type]} on ${selectedSquare}.`
            : interactionsDisabled
              ? 'The board is visible, but interaction is disabled for this state.'
              : 'Select a piece, then choose a legal destination square.'}
        </p>
      </div>

      <div
        className={cn(
          'mt-4 rounded-[18px] border p-4',
          feedback.kind === 'rejected'
            ? 'border-amber-300 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-950/20'
            : feedback.kind === 'accepted'
              ? 'border-sky-200 bg-sky-50/80 dark:border-sky-800 dark:bg-sky-950/20'
              : 'border-chatbox-border-primary bg-chatbox-background-secondary'
        )}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-chatbox-tertiary">{feedback.title}</p>
        <p className="mt-2 text-sm text-chatbox-primary">{feedback.message}</p>
      </div>
    </div>
  )
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
