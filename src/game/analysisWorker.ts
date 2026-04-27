import type { Cell, Color, Position } from './types';
import { getAnalysisResult, type AnalysisResult } from './ai';

export interface AnalysisRequest {
    cells: Cell[];
    currentTurn: Color;
    enPassantTarget: Position | null;
    id: number;
}

interface AnalysisResponse {
    result: AnalysisResult | null;
    id: number;
}

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
    const { cells, currentTurn, enPassantTarget, id } = e.data;
    try {
        const result = getAnalysisResult(cells, currentTurn, enPassantTarget, 5, 3);
        self.postMessage({ result, id } satisfies AnalysisResponse);
    } catch {
        self.postMessage({ result: null, id } satisfies AnalysisResponse);
    }
};
