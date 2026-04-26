import { useState, useEffect, useRef } from 'react';
import type { Cell, Color, Position } from '../game/types';
import type { AnalysisResult } from '../game/ai';

interface AnalysisResponse {
    result: AnalysisResult | null;
    id: number;
}

export function useAnalysis(
    enabled: boolean,
    cells: Cell[],
    currentTurn: Color,
    enPassantTarget: Position | null,
) {
    const [result, setResult] = useState<AnalysisResult | null>(null);
    const [loading, setLoading] = useState(false);

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
            setResult(null);
            setLoading(false);
            return;
        }

        const worker = workerRef.current;
        if (!worker) return;

        const id = ++latestId.current;
        setLoading(true);

        const handler = (e: MessageEvent<AnalysisResponse>) => {
            // Ignore stale results from superseded requests
            if (e.data.id !== id) return;
            setLoading(false);
            if (e.data.result) setResult(e.data.result);
        };

        worker.addEventListener('message', handler);
        worker.postMessage({ cells, currentTurn, enPassantTarget, id });

        return () => {
            worker.removeEventListener('message', handler);
        };
    }, [enabled, cells, currentTurn, enPassantTarget]);

    return { result, loading };
}
