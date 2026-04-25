import { getBotMove, type Difficulty } from './ai';
import type { Cell, Color, Position } from './types';

interface BotRequest {
    cells: Cell[];
    botColor: Color;
    enPassantTarget: Position | null;
    difficulty: Difficulty;
}

self.onmessage = (e: MessageEvent<BotRequest>) => {
    const { cells, botColor, enPassantTarget, difficulty } = e.data;
    const move = getBotMove(cells, botColor, enPassantTarget, difficulty);
    self.postMessage(move);
};
