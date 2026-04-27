import { useState, useEffect, useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Cell, Color, Position } from '../game/types';
import type { Difficulty } from '../game/ai';
import type { PromoPieceType } from './useGame';

/** Maximum milliseconds the bot worker is allowed to think before being killed and retried. */
const THINK_TIMEOUT_MS = 8_000;

/** Number of times a timed-out search will be retried before giving up on the current position. */
const MAX_RETRIES = 3;

/**
 * Terminates any existing bot worker held by `ref` and spawns a fresh one,
 * storing it back in `ref.current`.
 *
 * Replacing the worker rather than reusing it avoids receiving stale move
 * messages from a previously timed-out search.
 *
 * @param ref - A mutable ref that holds the current worker instance (or `null`).
 * @returns The newly created {@link Worker}.
 */
function spawnWorker(ref: MutableRefObject<Worker | null>): Worker {
    ref.current?.terminate();
    const w = new Worker(new URL('../game/botWorker.ts', import.meta.url), { type: 'module' });
    ref.current = w;
    return w;
}

/**
 * Options passed to {@link useBot}.
 */
interface UseBotOptions {
    /** Current game mode; the bot only activates when this equals `'bot'`. */
    mode: string;
    /** Current board state as an array of {@link Cell} objects. */
    cells: Cell[];
    /** The color whose turn it is to move. */
    currentTurn: Color;
    /** Square eligible for en-passant capture this half-move, or `null`. */
    enPassantTarget: Position | null;
    /** `true` once the game has ended by checkmate or stalemate. */
    isGameOver: boolean;
    /** The square of a pawn awaiting promotion, or `null` if none is pending. */
    promotionPending: Position | null;
    /** Callback invoked with the bot's chosen move. Delegated from {@link useGame}. */
    executeBotMove: (from: Position, to: Position) => void;
    /** Callback to resolve a promotion choice. The bot always promotes to queen. */
    confirmPromotion: (piece: PromoPieceType) => void;
}

/**
 * Values returned by {@link useBot}.
 */
export interface UseBotResult {
    /** `true` after {@link UseBotResult.startBot} has been called and the bot is active. */
    botReady: boolean;
    /** The human player's color for the current bot game. */
    playerColor: Color;
    /** The bot's color (always the opposite of {@link UseBotResult.playerColor}). */
    botColor: Color;
    /**
     * `true` when the board should be rendered upside-down because the human
     * player chose to play as black.
     */
    flipped: boolean;
    /** `true` while the bot worker is computing a move. */
    isThinking: boolean;
    /**
     * Activates the bot with the given player color and difficulty level.
     * Typically called after a new game is started via {@link UseBotResult.resetBot}.
     *
     * @param color - The color the human player wants to play.
     * @param diff - The search difficulty level.
     */
    startBot: (color: Color, diff: Difficulty) => void;
    /** Deactivates the bot and resets its internal state, ready for a new game setup. */
    resetBot: () => void;
}

/**
 * Manages a Glinski Hexagonal Chess AI opponent backed by a dedicated Web Worker.
 *
 * The hook is responsible for:
 * - Spawning and keeping alive a bot {@link Worker} for the session.
 * - Sending the current board position to the worker when it is the bot's turn.
 * - Applying the returned move via `executeBotMove`.
 * - Retrying up to {@link MAX_RETRIES} times if the worker exceeds
 *   {@link THINK_TIMEOUT_MS}, then giving up gracefully rather than hanging.
 * - Auto-promoting to queen whenever the bot's pawn reaches a promotion square.
 *
 * The hook is a no-op when `mode !== 'bot'` or `botReady === false`, so it is
 * safe to mount unconditionally in the game page regardless of the active mode.
 *
 * @param options - See {@link UseBotOptions}.
 * @returns See {@link UseBotResult}.
 */
export function useBot({
    mode,
    cells,
    currentTurn,
    enPassantTarget,
    isGameOver,
    promotionPending,
    executeBotMove,
    confirmPromotion,
}: UseBotOptions): UseBotResult {
    const [botReady, setBotReady]       = useState(false);
    const [playerColor, setPlayerColor] = useState<Color>('white');
    const [difficulty, setDifficulty]   = useState<Difficulty>('medium');
    const [isThinking, setIsThinking]   = useState(false);
    const [retrySignal, setRetrySignal] = useState(0);

    const botColor: Color = playerColor === 'white' ? 'black' : 'white';
    const flipped = mode === 'bot' && playerColor === 'black';

    const workerRef    = useRef<Worker | null>(null);
    const retryCount   = useRef(0);

    useEffect(() => {
        spawnWorker(workerRef);
        return () => { workerRef.current?.terminate(); workerRef.current = null; };
    }, []);

    // Reset the retry counter whenever it becomes the bot's turn (fresh position).
    useEffect(() => {
        if (currentTurn === botColor) retryCount.current = 0;
    }, [currentTurn, botColor]);

    useEffect(() => {
        if (mode !== 'bot' || !botReady) return;
        if (currentTurn !== botColor) return;
        if (isGameOver) return;
        if (promotionPending) return;

        const worker = workerRef.current;
        if (!worker) return;

        let cancelled = false;

        const handler = (e: MessageEvent) => {
            if (cancelled) return;
            setIsThinking(false);
            const move = e.data;
            if (move) executeBotMove(move.from, move.to);
        };

        worker.addEventListener('message', handler, { once: true });

        const sendTimer = setTimeout(() => {
            if (cancelled) return;
            setIsThinking(true);
            worker.postMessage({ cells, botColor, enPassantTarget, difficulty });
        }, 350);

        // If the worker takes too long, terminate it, spin up a fresh one, and retry
        // up to MAX_RETRIES times. Without a cap, a position that consistently times
        // out would increment retrySignal forever, re-firing this effect each time.
        const timeoutTimer = setTimeout(() => {
            if (cancelled) return;
            if (retryCount.current >= MAX_RETRIES) {
                setIsThinking(false);
                return;
            }
            cancelled = true;
            setIsThinking(false);
            worker.removeEventListener('message', handler);
            spawnWorker(workerRef);
            retryCount.current += 1;
            setRetrySignal(s => s + 1);
        }, 350 + THINK_TIMEOUT_MS);

        return () => {
            cancelled = true;
            clearTimeout(sendTimer);
            clearTimeout(timeoutTimer);
            worker.removeEventListener('message', handler);
            setIsThinking(false);
        };
    }, [mode, botReady, currentTurn, botColor, isGameOver, promotionPending,
        cells, enPassantTarget, difficulty, executeBotMove, retrySignal]);

    // Auto-promote to queen for the bot.
    useEffect(() => {
        if (mode !== 'bot' || !botReady) return;
        if (!promotionPending) return;
        if (currentTurn !== botColor) return;
        confirmPromotion('queen');
    }, [mode, botReady, promotionPending, currentTurn, botColor, confirmPromotion]);

    const startBot = useCallback((color: Color, diff: Difficulty) => {
        setPlayerColor(color);
        setDifficulty(diff);
        setBotReady(true);
    }, []);

    const resetBot = useCallback(() => {
        setBotReady(false);
        setIsThinking(false);
    }, []);

    return { botReady, playerColor, botColor, flipped, isThinking, startBot, resetBot };
}
