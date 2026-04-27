import { useState, useCallback, useRef } from 'react';
import { type Cell, type Color, type Piece, type Position, type MoveRecord, oppositeColor } from '../game/types';
import { generateBoard, samePos, applyMove, computeEnPassantTarget, posKey, parseJan } from '../game/board';
import { getLegalMoves, getGameStatus, isPromotionSquare } from '../game/gameLogic';
import {
    buildNotation,
    addToHistory,
    parseSanToken,
    PROMO_LETTERS,
    type PromoPieceType,
} from '../game/notation';

// Re-export so consumers (useBot, Board) don't need to change their import sites.
export type { PromoPieceType };

/** Tracks a pawn promotion that is waiting for the player to pick a piece. */
interface PendingPromotion {
    /** Board square that the promoting pawn now occupies. */
    pos: Position;
    /**
     * Partial move notation built before the promotion piece was chosen
     * (e.g. `"g6"` for a pawn that moved to g6). The chosen piece letter and
     * any check symbol are appended once the player confirms their selection.
     */
    baseNotation: string;
    /** Color of the pawn that is promoting. */
    color: Color;
}

/** Full board snapshot pushed before each move so undo can restore it. */
interface GameSnapshot {
    /** Complete array of board cells at the time of the snapshot. */
    cells: Cell[];
    /** Whose turn it was before the move was applied. */
    currentTurn: Color;
    /** En-passant target square active at the time of the snapshot. */
    enPassantTarget: Position | null;
    /** Game status at the time of the snapshot. */
    gameStatus: 'playing' | 'check' | 'checkmate' | 'stalemate';
    /** Pieces captured by white up to and including this point. */
    capturedByWhite: Piece[];
    /** Pieces captured by black up to and including this point. */
    capturedByBlack: Piece[];
    /** Move history list at the time of the snapshot. */
    moveHistory: MoveRecord[];
    /** Any pending promotion state that was active at the time of the snapshot. */
    pendingPromotion: PendingPromotion | null;
}

/**
 * Determines which piece (if any) is captured by a move to `to`.
 *
 * Handles both normal captures (a piece already occupying `to`) and
 * en-passant captures, where the captured pawn sits on an adjacent rank
 * rather than on `to` itself.
 *
 * @param cells - Current board cells.
 * @param to - Destination square of the moving piece.
 * @param enPassantTarget - Active en-passant target square, or `null`.
 * @param movingColor - Color of the piece that is moving.
 * @returns The captured {@link Piece}, or `null` if the move is not a capture.
 */
function findCapture(cells: Cell[], to: Position, enPassantTarget: Position | null, movingColor: Color): Piece | null {
    const normal = cells.find(c => samePos(c, to))?.piece ?? null;
    if (normal) return normal;
    if (!enPassantTarget || !samePos(to, enPassantTarget)) return null;
    const epCapturedR = enPassantTarget.r + (movingColor === 'white' ? -1 : 1);
    return cells.find(c => c.q === enPassantTarget.q && c.r === epCapturedR)?.piece ?? null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Central state machine for a Glinski Hexagonal Chess game.
 *
 * Manages the full lifecycle of a game: board initialisation, legal-move
 * generation, move execution (including en-passant and promotion), game-status
 * evaluation, move-history recording, undo, and position loading from JAN /
 * PGN strings.
 *
 * The snapshot stack is stored in a ref rather than state so that pushing and
 * popping snapshots does not trigger unnecessary re-renders.
 *
 * @returns An object containing the complete game state and all actions needed
 *   to drive the UI:
 *
 * | Property | Description |
 * |---       |---          |
 * | `cells` | Current array of board cells. |
 * | `currentTurn` | Color whose turn it is to move. |
 * | `selectedPos` | Currently selected piece position, or `null`. |
 * | `validMoves` | Legal destination squares for the selected piece. |
 * | `handleCellClick` | Click handler for human players — selects pieces and executes moves. |
 * | `executeBotMove` | Executes a move directly (used by the bot hook). |
 * | `gameStatus` | Current game status: `'playing'`, `'check'`, `'checkmate'`, or `'stalemate'`. |
 * | `capturedByWhite` | Pieces captured by the white player. |
 * | `capturedByBlack` | Pieces captured by the black player. |
 * | `promotionPending` | Square of a pawn awaiting promotion, or `null`. |
 * | `confirmPromotion` | Resolves a pending promotion with the chosen piece type. |
 * | `resetGame` | Restores the board to the standard Glinski starting position. |
 * | `clearSelection` | Deselects the currently selected piece without making a move. |
 * | `moveHistory` | Ordered list of move records in the game's notation format. |
 * | `enPassantTarget` | Square that can be captured en-passant this half-move, or `null`. |
 * | `undoMove` | Pops the most-recent snapshot and restores the previous game state. |
 * | `canUndo` | `true` when there is at least one move to undo. |
 * | `loadPosition` | Replaces the board with a position parsed from a JAN string. |
 * | `loadPgn` | Replays a full game from a PGN-style move token string. |
 */
export function useGame() {
    const [cells, setCells] = useState<Cell[]>(() => generateBoard());
    const [currentTurn, setCurrentTurn] = useState<Color>('white');
    const [selectedPos, setSelectedPos] = useState<Position | null>(null);
    const [validMoves, setValidMoves] = useState<Position[]>([]);
    const [enPassantTarget, setEnPassantTarget] = useState<Position | null>(null);
    const [gameStatus, setGameStatus] = useState<'playing' | 'check' | 'checkmate' | 'stalemate'>('playing');
    const [capturedByWhite, setCapturedByWhite] = useState<Piece[]>([]);
    const [capturedByBlack, setCapturedByBlack] = useState<Piece[]>([]);
    const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
    const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([]);
    const [canUndo, setCanUndo] = useState(false);

    // Snapshot stack stored in a ref — changes here don't need to trigger re-renders.
    const snapshotsRef = useRef<GameSnapshot[]>([]);

    /**
     * Applies a validated move from `from` to `to`, updating all game state.
     *
     * Pushes the current state onto the undo stack before mutating anything.
     * If the move results in a pawn reaching a promotion square, the turn is
     * NOT advanced; instead a {@link PendingPromotion} is stored and the move
     * history entry is deferred until {@link confirmPromotion} is called.
     *
     * @param from - Origin square of the piece being moved.
     * @param to - Destination square.
     */
    const executeMove = useCallback((from: Position, to: Position) => {
        const movingPiece = cells.find(c => samePos(c, from))?.piece;
        if (!movingPiece) return;

        // Push snapshot of current state so undo can restore it
        snapshotsRef.current.push({
            cells,
            currentTurn,
            enPassantTarget,
            gameStatus,
            capturedByWhite,
            capturedByBlack,
            moveHistory,
            pendingPromotion,
        });
        setCanUndo(true);

        const newEnPassantTarget = computeEnPassantTarget(from, to, movingPiece);
        const captured = findCapture(cells, to, enPassantTarget, movingPiece.color);

        if (captured) {
            if (movingPiece.color === 'white') setCapturedByWhite(prev => [...prev, captured]);
            else setCapturedByBlack(prev => [...prev, captured]);
        }

        const newCells = applyMove(cells, from, to, enPassantTarget, movingPiece.color);
        const nextTurn = oppositeColor(currentTurn);
        const isPromotion = movingPiece.type === 'pawn' && isPromotionSquare(to.q, to.r, movingPiece.color);

        setCells(newCells);
        setEnPassantTarget(newEnPassantTarget);
        setSelectedPos(null);
        setValidMoves([]);

        if (isPromotion) {
            // Defer writing to move history until the piece is chosen — no '=?' sentinel needed.
            const baseNotation = buildNotation(movingPiece, from, to, !!captured, '', cells, enPassantTarget);
            setPendingPromotion({ pos: to, baseNotation, color: movingPiece.color });
        } else {
            const nextStatus = getGameStatus(newCells, nextTurn, newEnPassantTarget);
            const notation = buildNotation(movingPiece, from, to, !!captured, nextStatus, cells, enPassantTarget);
            setMoveHistory(prev => addToHistory(prev, movingPiece.color, notation));
            setCurrentTurn(nextTurn);
            setGameStatus(nextStatus);
        }
    }, [cells, currentTurn, enPassantTarget, gameStatus, capturedByWhite, capturedByBlack, moveHistory, pendingPromotion]);

    /**
     * Handles a human player clicking on a board cell.
     *
     * Selection/move logic (in priority order):
     * 1. If a promotion is pending, the click is ignored.
     * 2. If the game is over, the click is ignored.
     * 3. If a piece is selected and the clicked square is a valid destination,
     *    the move is executed.
     * 4. If the clicked cell belongs to the current player, it becomes selected
     *    and its legal moves are computed.
     * 5. Otherwise the selection is cleared.
     *
     * @param q - Axial column coordinate of the clicked cell.
     * @param r - Axial row coordinate of the clicked cell.
     */
    const handleCellClick = useCallback((q: number, r: number) => {
        if (pendingPromotion) return;
        if (gameStatus === 'checkmate' || gameStatus === 'stalemate') return;

        const clicked: Position = { q, r };
        const clickedCell = cells.find(c => c.q === q && c.r === r);

        if (selectedPos && validMoves.some(m => samePos(m, clicked))) {
            executeMove(selectedPos, clicked);
            return;
        }

        if (clickedCell?.piece?.color === currentTurn) {
            setSelectedPos(clicked);
            setValidMoves(getLegalMoves(cells, clicked, enPassantTarget));
            return;
        }

        setSelectedPos(null);
        setValidMoves([]);
    }, [cells, currentTurn, selectedPos, validMoves, enPassantTarget, gameStatus, pendingPromotion, executeMove]);

    /**
     * Resets all game state to the standard Glinski starting position.
     *
     * Clears the undo stack, captured pieces, move history, and any pending
     * promotion. White moves first.
     */
    const resetGame = useCallback(() => {
        setCells(generateBoard());
        setCurrentTurn('white');
        setSelectedPos(null);
        setValidMoves([]);
        setEnPassantTarget(null);
        setGameStatus('playing');
        setCapturedByWhite([]);
        setCapturedByBlack([]);
        setPendingPromotion(null);
        setMoveHistory([]);
        snapshotsRef.current = [];
        setCanUndo(false);
    }, []);

    /**
     * Pops the most-recent {@link GameSnapshot} from the undo stack and
     * restores all game state to that point.
     *
     * Does nothing if the stack is empty. The selection is always cleared on
     * undo regardless of the restored snapshot's selection state.
     */
    const undoMove = useCallback(() => {
        const stack = snapshotsRef.current;
        if (stack.length === 0) return;
        const snap = stack[stack.length - 1];
        snapshotsRef.current = stack.slice(0, -1);

        setCells(snap.cells);
        setCurrentTurn(snap.currentTurn);
        setEnPassantTarget(snap.enPassantTarget);
        setGameStatus(snap.gameStatus);
        setCapturedByWhite(snap.capturedByWhite);
        setCapturedByBlack(snap.capturedByBlack);
        setMoveHistory(snap.moveHistory);
        setPendingPromotion(snap.pendingPromotion);
        setSelectedPos(null);
        setValidMoves([]);
        setCanUndo(snapshotsRef.current.length > 0);
    }, []);

    /**
     * Loads a custom starting position from a JAN (JSON Algebraic Notation)
     * string, replacing the current board state.
     *
     * The board geometry is regenerated from scratch and pieces are placed
     * according to the parsed JAN data. All other state (turn, history, undo
     * stack) is reset to defaults. Logs a warning and leaves the board
     * unchanged if the JAN string is invalid.
     *
     * @param jan - A JAN-format string describing the piece placement.
     */
    const loadPosition = useCallback((jan: string) => {
        try {
            const pieces = parseJan(jan);
            const newCells = generateBoard().map(cell => ({
                ...cell,
                piece: pieces.get(posKey(cell)) ?? null,
            }));
            setCells(newCells);
            setCurrentTurn('white');
            setSelectedPos(null);
            setValidMoves([]);
            setEnPassantTarget(null);
            setGameStatus('playing');
            setCapturedByWhite([]);
            setCapturedByBlack([]);
            setPendingPromotion(null);
            setMoveHistory([]);
            snapshotsRef.current = [];
            setCanUndo(false);
        } catch (err) {
            console.warn('loadPosition: invalid JAN string', err);
        }
    }, []);

    /**
     * Replays a game from a PGN-style move token string, restoring the board
     * to the final position and populating the undo stack so every half-move
     * can be stepped back through.
     *
     * The format mirrors the app's own export: move numbers are optional and
     * are stripped before processing. Result tokens (`1-0`, `0-1`, etc.) are
     * also stripped. Replay stops early on the first unparseable token or if
     * the game reaches checkmate/stalemate.
     *
     * @example
     * ```ts
     * loadPgn('1. e4 e5 2. Nf3 Nc6');
     * ```
     *
     * @param pgn - PGN-style string containing the move tokens to replay.
     */
    const loadPgn = useCallback((pgn: string) => {
        const tokens = pgn
            .replace(/\d+\./g, '')
            .replace(/1-0|0-1|1\/2-1\/2|\*/g, '')
            .trim()
            .split(/\s+/)
            .filter(t => t.length > 0);

        let cCells = generateBoard();
        let cTurn: Color = 'white';
        let cEp: Position | null = null;
        let cCapW: Piece[] = [];
        let cCapB: Piece[] = [];
        let cHistory: MoveRecord[] = [];
        let cStatus: 'playing' | 'check' | 'checkmate' | 'stalemate' = 'playing';
        const newSnapshots: GameSnapshot[] = [];

        for (const token of tokens) {
            const parsed = parseSanToken(token, cCells, cTurn, cEp);
            if (!parsed) break;

            const { from, to, promotion } = parsed;
            const movingPiece = cCells.find(c => c.q === from.q && c.r === from.r)?.piece;
            if (!movingPiece) break;

            newSnapshots.push({
                cells: cCells, currentTurn: cTurn, enPassantTarget: cEp,
                gameStatus: cStatus, capturedByWhite: cCapW, capturedByBlack: cCapB,
                moveHistory: cHistory, pendingPromotion: null,
            });

            const captured = findCapture(cCells, to, cEp, movingPiece.color);
            if (captured) {
                if (movingPiece.color === 'white') cCapW = [...cCapW, captured];
                else cCapB = [...cCapB, captured];
            }

            const newEp = computeEnPassantTarget(from, to, movingPiece);
            let newCells = applyMove(cCells, from, to, cEp, movingPiece.color);

            // Apply promotion (explicit or auto-queen if piece reached promo square)
            if (movingPiece.type === 'pawn' && isPromotionSquare(to.q, to.r, movingPiece.color)) {
                const promoType: PromoPieceType = promotion ?? 'queen';
                newCells = newCells.map(c =>
                    c.q === to.q && c.r === to.r
                        ? { ...c, piece: { type: promoType, color: movingPiece.color } }
                        : c,
                );
            }

            const nextTurn = oppositeColor(cTurn);
            const nextStatus = getGameStatus(newCells, nextTurn, newEp);
            cHistory = addToHistory(cHistory, movingPiece.color, token);
            cCells = newCells;
            cEp = newEp;
            cTurn = nextTurn;
            cStatus = nextStatus;

            if (cStatus === 'checkmate' || cStatus === 'stalemate') break;
        }

        setCells(cCells);
        setCurrentTurn(cTurn);
        setEnPassantTarget(cEp);
        setGameStatus(cStatus);
        setCapturedByWhite(cCapW);
        setCapturedByBlack(cCapB);
        setMoveHistory(cHistory);
        setPendingPromotion(null);
        setSelectedPos(null);
        setValidMoves([]);
        snapshotsRef.current = newSnapshots;
        setCanUndo(newSnapshots.length > 0);
    }, []);

    /** Deselects the currently selected piece without executing any move. */
    const clearSelection = useCallback(() => {
        setSelectedPos(null);
        setValidMoves([]);
    }, []);

    /**
     * Resolves a pending pawn promotion by replacing the promoting pawn with
     * the chosen piece, then advancing the turn and evaluating game status.
     *
     * Also finalises the deferred move-history entry with the promotion
     * suffix (e.g. `=Q`) and any check/checkmate symbol.
     *
     * Does nothing if there is no promotion currently pending.
     *
     * @param pieceType - The piece type the player (or bot) has chosen.
     */
    const confirmPromotion = useCallback((pieceType: PromoPieceType) => {
        if (!pendingPromotion) return;
        const { pos, baseNotation, color } = pendingPromotion;
        const newCells = cells.map(cell =>
            samePos(cell, pos)
                ? { ...cell, piece: { type: pieceType, color } }
                : cell,
        );
        const nextTurn = oppositeColor(color);
        const nextStatus = getGameStatus(newCells, nextTurn, enPassantTarget);
        const checkSym = nextStatus === 'checkmate' ? '#' : nextStatus === 'check' ? '+' : '';
        const fullNotation = `${baseNotation}=${PROMO_LETTERS[pieceType]}${checkSym}`;

        setMoveHistory(prev => addToHistory(prev, color, fullNotation));
        setCells(newCells);
        setCurrentTurn(nextTurn);
        setPendingPromotion(null);
        setGameStatus(nextStatus);
    }, [pendingPromotion, cells, enPassantTarget]);

    return {
        cells,
        currentTurn,
        selectedPos,
        validMoves,
        handleCellClick,
        executeBotMove: executeMove,
        gameStatus,
        capturedByWhite,
        capturedByBlack,
        promotionPending: pendingPromotion?.pos ?? null,
        confirmPromotion,
        resetGame,
        clearSelection,
        moveHistory,
        enPassantTarget,
        undoMove,
        canUndo,
        loadPosition,
        loadPgn,
    };
}
