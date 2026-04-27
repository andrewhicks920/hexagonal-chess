import { useReducer, useEffect, useRef } from 'react';
import type { Cell, Color, Position } from '../game/types';
import type { AnalysisResult } from '../game/ai';

/**
 * Message shape returned by the analysis Web Worker for each completed search.
 *
 * The `id` field is used to correlate responses with requests so that stale
 * results from superseded positions are silently discarded.
 */
interface AnalysisResponse {
    /** The completed analysis, or `null` if the worker produced no result. */
    result: AnalysisResult | null;
    /** Monotonically-increasing request identifier echoed back by the worker. */
    id: number;
}

/** Return value of {@link useAnalysis}. */
interface AnalysisState {
    /** The latest analysis result, or `null` while waiting for the first result. */
    result: AnalysisResult | null;
    /** `true` while a search is in flight. */
    loading: boolean;
}

const IDLE_STATE: AnalysisState = { result: null, loading: false };

type AnalysisAction =
    | { type: 'reset' }
    | { type: 'loading' }
    | { type: 'result'; payload: AnalysisResult | null };

function analysisReducer(_state: AnalysisState, action: AnalysisAction): AnalysisState {
    switch (action.type) {
        case 'reset':   return IDLE_STATE;
        case 'loading': return { result: _state.result, loading: true };
        case 'result':  return { result: action.payload, loading: false };
    }
}

/**
 * Runs a continuous board-analysis search on a dedicated Web Worker and
 * exposes the most-recent result to the caller.
 *
 * A single worker is spawned when the hook mounts and kept alive for the
 * entire session; it is terminated on unmount. Whenever the board position
 * changes a new request (with a fresh `id`) is posted. Any response whose
 * `id` does not match the latest request is ignored, so UI state always
 * reflects the current position rather than a previous one.
 *
 * @param enabled - When `false` the hook posts no requests and resets state
 *   to idle. Use this to disable analysis outside of analysis mode.
 * @param cells - Current board state, as an array of {@link Cell} objects.
 * @param currentTurn - The color whose turn it is to move.
 * @param enPassantTarget - The square that can be captured en-passant this
 *   half-move, or `null` if none is available.
 * @returns {@link AnalysisState} with the latest result and loading flag.
 */
export function useAnalysis(
    enabled: boolean,
    cells: Cell[],
    currentTurn: Color,
    enPassantTarget: Position | null,
): AnalysisState {
    const [state, dispatch] = useReducer(analysisReducer, IDLE_STATE);

    const workerRef  = useRef<Worker | null>(null);
    const latestId   = useRef(0);

    // Spawn once; keep alive for the session.
    useEffect(() => {
        const w = new Worker(
            new URL('../game/analysisWorker.ts', import.meta.url),
            { type: 'module' },
        );
        workerRef.current = w;
        return () => { w.terminate(); workerRef.current = null; };
    }, []);

    useEffect(() => {
        if (!enabled) {
            dispatch({ type: 'reset' });
            return;
        }

        const worker = workerRef.current;
        if (!worker) return;

        const id = ++latestId.current;
        dispatch({ type: 'loading' });

        const handler = (e: MessageEvent<AnalysisResponse>) => {
            // Ignore stale results from superseded requests
            if (e.data.id !== id) return;
            dispatch({ type: 'result', payload: e.data.result ?? null });
        };

        worker.addEventListener('message', handler);
        worker.postMessage({ cells, currentTurn, enPassantTarget, id });

        return () => {
            worker.removeEventListener('message', handler);
        };
    }, [enabled, cells, currentTurn, enPassantTarget]);

    return state;
}
