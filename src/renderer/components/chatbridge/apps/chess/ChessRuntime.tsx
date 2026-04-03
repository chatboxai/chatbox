import {
  applyChatBridgeChessMove,
  createChatBridgeChessGame,
  getChatBridgeChessLegalMoves,
  getChatBridgeChessStatusText,
  normalizeChatBridgeChessRuntimeSnapshot,
  undoChatBridgeChessMove,
  type ChatBridgeChessRuntimeFeedback,
  type ChatBridgeChessRuntimeSnapshot,
  type ChatBridgeChessRuntimeStatus,
} from '@shared/chatbridge'
import {
  ChessAppSnapshotSchema,
  createChessAppSnapshotFromGame,
  createChessMoveState,
  createInitialChessAppSnapshot,
  createRejectedChessSnapshot,
  getChessPieceAtSquare,
  getChessStatusLabel,
  getChessSummary,
  getTurnLabel,
  parseChessAppSnapshot,
  type ChessAppSnapshot,
} from '@shared/chatbridge/apps/chess'
import type { MessageAppPart } from '@shared/types'
import { Chess, type Piece, type Square } from 'chess.js'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { buildChessMessageAppPart, persistChessSnapshot } from '@/packages/chatbridge/chess-session-state'

interface ChessRuntimeProps {
  part: MessageAppPart
  sessionId?: string
  messageId?: string
  onUpdatePart?: (nextPart: MessageAppPart) => void
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const
const PIECE_FONT_FAMILY =
  '"Noto Sans Symbols 2", "Segoe UI Symbol", "Apple Symbols", "Arial Unicode MS", sans-serif'

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

const WHITE_PIECE_STYLE = {
  color: '#f8fafc',
  textShadow: '0 1px 1px rgba(15, 23, 42, 0.9), 0 0 2px rgba(15, 23, 42, 0.55)',
} satisfies CSSProperties

const BLACK_PIECE_STYLE = {
  color: '#111827',
  textShadow: '0 1px 0 rgba(248, 250, 252, 0.18)',
} satisfies CSSProperties

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isPersistentSnapshot(snapshot: unknown): snapshot is ChessAppSnapshot {
  return ChessAppSnapshotSchema.safeParse(snapshot).success
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

function buildLegacyPartFromSnapshot(part: MessageAppPart, snapshot: ChatBridgeChessRuntimeSnapshot): MessageAppPart {
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

function buildMoveRows(snapshot: ChessAppSnapshot) {
  const rows: Array<{ turn: number; white?: string; black?: string }> = []

  snapshot.moveHistory.forEach((move, index) => {
    const rowIndex = Math.floor(index / 2)
    const row = rows[rowIndex] ?? { turn: rowIndex + 1 }

    if (index % 2 === 0) {
      row.white = move.san
    } else {
      row.black = move.san
    }

    rows[rowIndex] = row
  })

  return rows
}

function getSquareName(file: (typeof FILES)[number], rank: (typeof RANKS)[number]) {
  return `${file}${rank}`
}

function getSquareAriaLabel(snapshot: ChessAppSnapshot, square: string) {
  const piece = getChessPieceAtSquare(snapshot, square)
  if (!piece) {
    return `${square} empty square`
  }

  return `${square} ${piece.color} ${piece.piece}`
}

function getPieceGlyphStyle(color: 'white' | 'black' | 'w' | 'b') {
  return color === 'white' || color === 'w' ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE
}

function readChessSnapshot(part: MessageAppPart): ChessAppSnapshot {
  try {
    return parseChessAppSnapshot(part.snapshot)
  } catch {
    return createInitialChessAppSnapshot()
  }
}

function LegacyChessRuntime({ part, onUpdatePart }: ChessRuntimeProps) {
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
    onUpdatePart?.(buildLegacyPartFromSnapshot(part, nextSnapshot))
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
                    <span aria-hidden="true" style={getPieceGlyphStyle(piece.color)}>
                      {PIECE_GLYPHS[piece.color][piece.type]}
                    </span>
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

function PersistentChessRuntime({ part, sessionId, messageId, onUpdatePart }: ChessRuntimeProps) {
  const snapshot = readChessSnapshot(part)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [transientMessage, setTransientMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTransientMessage(null)
  }, [snapshot.lastUpdatedAt])

  const selectedPiece = selectedSquare ? getChessPieceAtSquare(snapshot, selectedSquare) : null
  const game = useMemo(() => new Chess(snapshot.fen), [snapshot.fen])
  const legalTargets: string[] = useMemo(
    () =>
      selectedSquare ? game.moves({ square: selectedSquare as Square, verbose: true }).map((move) => `${move.to}`) : [],
    [game, selectedSquare]
  )
  const moveRows = buildMoveRows(snapshot)
  const latestMove = snapshot.moveHistory.at(-1)
  const latestMessage = transientMessage || snapshot.lastAction.message

  const commitSnapshot = async (nextSnapshot: ChessAppSnapshot) => {
    setSaving(true)

    try {
      if (sessionId && messageId) {
        await persistChessSnapshot({
          sessionId,
          messageId,
          part,
          snapshot: nextSnapshot,
        })
      } else if (onUpdatePart) {
        onUpdatePart(buildChessMessageAppPart(part, nextSnapshot))
      } else {
        setTransientMessage('Chess runtime is read-only in this surface.')
      }
    } catch (error) {
      setTransientMessage(error instanceof Error ? error.message : 'Failed to persist the chess runtime state.')
    } finally {
      setSaving(false)
    }
  }

  const handleSquareClick = async (square: string) => {
    if (saving) {
      return
    }

    if (snapshot.status.phase === 'complete') {
      setSelectedSquare(null)
      await commitSnapshot(
        createRejectedChessSnapshot(snapshot, {
          message: 'The game is already complete. Reseed the fixture to start from the opening position again.',
          attemptedFrom: selectedSquare ?? undefined,
          attemptedTo: square,
        })
      )
      return
    }

    const clickedPiece = getChessPieceAtSquare(snapshot, square)

    if (!selectedSquare) {
      if (!clickedPiece) {
        setTransientMessage(`Select a ${getTurnLabel(snapshot.turn).toLowerCase()} piece to start a move.`)
        return
      }

      if (clickedPiece.color !== snapshot.turn) {
        setTransientMessage(`It is ${getTurnLabel(snapshot.turn).toLowerCase()}'s turn. Pick one of that side's pieces.`)
        return
      }

      setSelectedSquare(square)
      setTransientMessage(null)
      return
    }

    if (selectedSquare === square) {
      setSelectedSquare(null)
      setTransientMessage('Selection cleared.')
      return
    }

    if (clickedPiece && clickedPiece.color === snapshot.turn && selectedPiece?.color === clickedPiece.color) {
      setSelectedSquare(square)
      setTransientMessage(null)
      return
    }

    const nextGame = new Chess(snapshot.fen)
    let attemptedMove: ReturnType<Chess['move']> | null = null

    try {
      attemptedMove = nextGame.move({
        from: selectedSquare,
        to: square,
        promotion: 'q',
      })
    } catch {
      attemptedMove = null
    }

    setSelectedSquare(null)

    if (!attemptedMove) {
      await commitSnapshot(
        createRejectedChessSnapshot(snapshot, {
          message: `${selectedSquare.toUpperCase()} cannot move to ${square.toUpperCase()} from the current board state.`,
          attemptedFrom: selectedSquare,
          attemptedTo: square,
        })
      )
      return
    }

    const now = Date.now()
    const moveState = createChessMoveState(attemptedMove, snapshot.moveHistory.length + 1, now)
    const nextSnapshot = createChessAppSnapshotFromGame(nextGame, {
      lastUpdatedAt: now,
      lastAction: {
        kind: 'accepted',
        message: `Accepted ${attemptedMove.san}. ${getTurnLabel(nextGame.turn() === 'w' ? 'white' : 'black')} to move.`,
        move: moveState,
      },
    })

    await commitSnapshot(nextSnapshot)
  }

  return (
    <div className="rounded-[20px] bg-chatbox-background-primary p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-chatbox-border-primary pb-3">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-[11px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            {getChessStatusLabel(snapshot)}
          </span>
          <span className="inline-flex items-center rounded-full bg-stone-200 px-3 py-1 text-[11px] font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200">
            {saving ? 'Syncing host state' : 'Host-owned runtime'}
          </span>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-chatbox-tertiary">Host-owned board</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.9fr)]">
        <section className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-chatbox-tertiary">Board</p>
              <p className="mt-1 text-sm text-chatbox-primary">{getChessSummary(snapshot)}</p>
            </div>
            <div className="rounded-full border border-chatbox-border-primary px-3 py-1 text-xs text-chatbox-tertiary">
              {snapshot.moveHistory.length} half-move{snapshot.moveHistory.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="mx-auto grid max-w-[32rem] grid-cols-[auto_repeat(8,minmax(0,1fr))] gap-1">
            <div />
            {FILES.map((file) => (
              <div key={`file-${file}`} className="pb-1 text-center text-[11px] font-semibold uppercase text-chatbox-tertiary">
                {file}
              </div>
            ))}

            {RANKS.map((rank, rankIndex) => (
              <div key={`rank-row-${rank}`} className="contents">
                <div className="flex items-center justify-center text-[11px] font-semibold text-chatbox-tertiary">{rank}</div>
                {FILES.map((file, fileIndex) => {
                  const square = getSquareName(file, rank)
                  const piece = getChessPieceAtSquare(snapshot, square)
                  const isLightSquare = (rankIndex + fileIndex) % 2 === 0
                  const isSelected = selectedSquare === square
                  const isLegalTarget = legalTargets.includes(square)
                  const isLastMove =
                    snapshot.lastAction.kind === 'accepted' &&
                    (snapshot.lastAction.move.from === square || snapshot.lastAction.move.to === square)

                  return (
                    <button
                      key={square}
                      type="button"
                      aria-label={getSquareAriaLabel(snapshot, square)}
                      className={cn(
                        'relative aspect-square rounded-[10px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chatbox-tint-brand/70',
                        isLightSquare
                          ? 'bg-[#f2e8dc] text-slate-900'
                          : 'bg-[#8d5f43] text-white',
                        isSelected && 'border-blue-500 ring-2 ring-blue-500/40',
                        !isSelected && isLastMove && 'border-emerald-400',
                        !isSelected && !isLastMove && 'border-transparent',
                        !saving && 'hover:brightness-[0.97]'
                      )}
                      disabled={saving}
                      onClick={() => void handleSquareClick(square)}
                    >
                      {piece ? (
                        <span
                          aria-hidden="true"
                          className="text-[1.85rem] leading-none sm:text-[2.1rem]"
                          style={{
                            ...getPieceGlyphStyle(piece.color),
                            fontFamily: PIECE_FONT_FAMILY,
                          }}
                        >
                          {piece.glyph}
                        </span>
                      ) : isLegalTarget ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            'absolute inset-0 flex items-center justify-center text-xl',
                            isLightSquare ? 'text-blue-700/80' : 'text-white/80'
                          )}
                        >
                          •
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4">
          <div
            className={cn(
              'rounded-[18px] border p-4',
              snapshot.lastAction.kind === 'rejected'
                ? 'border-amber-300 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-950/20'
                : snapshot.lastAction.kind === 'accepted'
                  ? 'border-sky-200 bg-sky-50/80 dark:border-sky-800 dark:bg-sky-950/20'
                  : 'border-chatbox-border-primary bg-chatbox-background-secondary'
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-chatbox-tertiary">Latest update</p>
            <p className="mt-2 text-sm text-chatbox-primary">{latestMessage}</p>
          </div>

          <div className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-chatbox-tertiary">Selection</p>
            <p className="mt-2 text-sm text-chatbox-primary">
              {selectedSquare && selectedPiece
                ? `${selectedSquare.toUpperCase()} selected: ${selectedPiece.color} ${selectedPiece.piece}.`
                : 'Select a piece, then click a destination square.'}
            </p>
            <p className="mt-2 text-xs text-chatbox-tertiary">
              {selectedSquare
                ? `${legalTargets.length} legal destination${legalTargets.length === 1 ? '' : 's'} highlighted from ${selectedSquare.toUpperCase()}.`
                : `${getTurnLabel(snapshot.turn)} to move.`}
            </p>
          </div>

          <div className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-chatbox-tertiary">Move ledger</p>
            {moveRows.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {moveRows.map((row) => (
                  <div key={`turn-${row.turn}`} className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 text-sm">
                    <span className="font-semibold text-chatbox-tertiary">{row.turn}.</span>
                    <span className="text-chatbox-primary">{row.white ?? '...'}</span>
                    <span className="text-chatbox-primary">{row.black ?? '...'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-chatbox-primary">No moves yet. Try `e2` to `e4`.</p>
            )}
          </div>

          <div className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-chatbox-tertiary">Host sync</p>
            <p className="mt-2 text-sm text-chatbox-primary">
              {latestMove
                ? `Latest legal move: ${latestMove.san} (${latestMove.from.toUpperCase()} to ${latestMove.to.toUpperCase()}).`
                : 'Opening position seeded and ready.'}
            </p>
            <p className="mt-2 text-xs break-all text-chatbox-tertiary">FEN: {snapshot.fen}</p>
            <p className="mt-2 text-xs text-chatbox-tertiary">
              Updated at {new Date(snapshot.lastUpdatedAt).toLocaleTimeString()}
            </p>
            <p className="mt-2 text-xs text-chatbox-tertiary">
              {saving
                ? 'Writing the updated board state back into the host session record.'
                : 'Every accepted change should survive a session reload through the host-owned snapshot.'}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

export function ChessRuntime(props: ChessRuntimeProps) {
  if (isPersistentSnapshot(props.part.snapshot)) {
    return <PersistentChessRuntime {...props} />
  }

  return <LegacyChessRuntime {...props} />
}
