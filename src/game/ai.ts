import { type Cell, type Color, type Position, type PieceType, oppositeColor } from './types';
import { getLegalMoves, getGameStatus, isPromotionSquare } from './gameLogic';
import { applyMove, computeEnPassantTarget } from './board';

/** Bot difficulty level, mapped to minimax search depth. */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Static piece values (in pawn units) used by the evaluation function.
 * King's value is deliberately large to dominate the score in checkmate positions.
 */
const PIECE_VALUES: Record<PieceType, number> = {
    pawn: 1,
    knight: 3,
    bishop: 3.5,
    rook: 5,
    queen: 9,
    king: 100,
};

/** A from–to pair representing a single half-move. */
interface Move {
    from: Position;
    to: Position;
}

/**
 * Transposition table entry.
 * `flag` distinguishes exact minimax values from alpha/beta bounds:
 *   - `'exact'`  — the stored score is the true minimax value.
 *   - `'lower'`  — a beta cutoff occurred; true value ≥ score.
 *   - `'upper'`  — a fail-low occurred; true value ≤ score.
 */
interface TTEntry {
    score: number;
    flag: 'exact' | 'lower' | 'upper';
}

/**
 * Static material evaluation relative to `color`.
 * Returns the sum of `color`'s piece values minus the opponent's.
 *
 * @param cells - Board state to evaluate.
 * @param color - The side the score is expressed from (positive = `color` is ahead).
 * @returns Net material advantage in pawn units.
 */
function evaluate(cells: Cell[], color: Color): number {
    let score = 0;
    for (const cell of cells) {
        if (!cell.piece) continue;
        const value = PIECE_VALUES[cell.piece.type];
        score += cell.piece.color === color ? value : -value;
    }
    return score;
}

/**
 * Computes the en-passant target that results from `move`, or `null`.
 * Thin wrapper around {@link computeEnPassantTarget} so minimax call sites stay readable.
 *
 * @param cells - Board state before the move is applied.
 * @param move - The half-move being played.
 * @returns The en-passant target square for the next ply, or `null`.
 */
function newEnPassant(cells: Cell[], move: Move): Position | null {
    const piece = cells.find(c => c.q === move.from.q && c.r === move.from.r)?.piece;
    return computeEnPassantTarget(move.from, move.to, piece);
}

/**
 * Applies `move` to `cells` and auto-promotes any pawn to queen.
 * Auto-promotion to queen is used so minimax always evaluates the strongest resulting piece;
 * the actual promotion choice is handled separately in the UI layer.
 *
 * @param cells - Board state before the move.
 * @param move - The half-move to apply.
 * @param enPassantTarget - En-passant target available this ply, or `null`.
 * @param color - Side making the move.
 * @returns A new `Cell[]` with the move applied and any promotion resolved to queen.
 */
function simulateMove(cells: Cell[], move: Move, enPassantTarget: Position | null, color: Color): Cell[] {
    const next = applyMove(cells, move.from, move.to, enPassantTarget, color);
    const piece = cells.find(c => c.q === move.from.q && c.r === move.from.r)?.piece;

    if (piece?.type === 'pawn' && isPromotionSquare(move.to.q, move.to.r, color)) {
        return next.map(cell =>
            cell.q === move.to.q && cell.r === move.to.r
                ? { ...cell, piece: { type: 'queen', color } }
                : cell,
        );
    }
    return next;
}

/**
 * Builds a compact string key for the current board position + en-passant state.
 * Cells are always generated in the same order (from `generateBoard`), so no sort is needed.
 */
function positionKey(cells: Cell[], enPassantTarget: Position | null): string {
    let key = '';
    for (const cell of cells) {
        if (cell.piece) key += `${cell.q},${cell.r}${cell.piece.color[0]}${cell.piece.type[0]};`;
    }
    if (enPassantTarget) key += `e${enPassantTarget.q},${enPassantTarget.r}`;
    return key;
}

/**
 * MVV-LVA score for move ordering: captures are searched first, prioritizing
 * high-value victims captured by low-value attackers, so alpha-beta cuts off more branches.
 */
function scoreMove(cells: Cell[], move: Move): number {
    const victim = cells.find(c => c.q === move.to.q && c.r === move.to.r)?.piece;
    if (!victim) return 0;
    const attacker = cells.find(c => c.q === move.from.q && c.r === move.from.r)?.piece;
    return PIECE_VALUES[victim.type] - (attacker ? PIECE_VALUES[attacker.type] * 0.1 : 0);
}

/**
 * Returns every legal move available to `color` in the given position.
 *
 * @param cells - Current board state.
 * @param color - The side whose moves to enumerate.
 * @param enPassantTarget - En-passant landing square available this turn, or `null`.
 * @returns All legal `Move` objects for `color`, in an unspecified order before sorting.
 */
function getAllMoves(cells: Cell[], color: Color, enPassantTarget: Position | null): Move[] {
    const moves: Move[] = [];
    for (const cell of cells) {
        if (cell.piece?.color !== color) continue;
        const from: Position = { q: cell.q, r: cell.r };
        for (const to of getLegalMoves(cells, from, enPassantTarget)) {
            moves.push({ from, to });
        }
    }
    return moves;
}

/**
 * Alpha-beta minimax search with a transposition table.
 *
 * @param cells - Board state at this node of the search tree.
 * @param depth - Remaining plies to search; returns the static evaluation at 0.
 * @param alpha - Lower bound for the maximizing player (best already found).
 * @param beta  - Upper bound for the minimizing player (best already found).
 * @param maximizing - `true` when it is the bot's turn to move.
 * @param botColor - The side the bot is playing; scores are always relative to this color.
 * @param enPassantTarget - En-passant target square available to the side to move at this node, or `null`.
 * @param tt - Transposition table shared across all nodes in this search.
 * @returns The heuristic value of `cells` from `botColor`'s perspective.
 */
function minimax(
    cells: Cell[],
    depth: number,
    alpha: number,
    beta: number,
    maximizing: boolean,
    botColor: Color,
    enPassantTarget: Position | null,
    tt: Map<string, TTEntry>,
): number {
    const sideToMove: Color = maximizing ? botColor : oppositeColor(botColor);
    const status = getGameStatus(cells, sideToMove, enPassantTarget);

    if (status === 'checkmate') return maximizing ? -10_000 : 10_000;
    if (status === 'stalemate') return maximizing ? -7_500 : 7_500;
    if (depth === 0) return evaluate(cells, botColor);

    // Transposition table lookup — adjust alpha/beta bounds or return early if exact.
    const ttKey = `${positionKey(cells, enPassantTarget)}|${depth}|${maximizing ? 1 : 0}`;
    const entry = tt.get(ttKey);
    if (entry !== undefined) {
        if (entry.flag === 'exact') return entry.score;
        if (entry.flag === 'lower') alpha = Math.max(alpha, entry.score);
        else                        beta  = Math.min(beta,  entry.score);
        if (alpha >= beta) return entry.score;
    }

    const origAlpha = alpha;
    const origBeta  = beta;

    const moves = getAllMoves(cells, sideToMove, enPassantTarget)
        .sort((a, b) => scoreMove(cells, b) - scoreMove(cells, a));

    let best: number;
    let cutoff = false;

    if (maximizing) {
        best = -Infinity;
        for (const move of moves) {
            const next = simulateMove(cells, move, enPassantTarget, sideToMove);
            const score = minimax(next, depth - 1, alpha, beta, false, botColor, newEnPassant(cells, move), tt);
            if (score > best) best = score;
            if (score > alpha) alpha = score;
            if (alpha >= beta) { cutoff = true; break; }
        }
    }
    else {
        best = Infinity;
        for (const move of moves) {
            const next = simulateMove(cells, move, enPassantTarget, sideToMove);
            const score = minimax(next, depth - 1, alpha, beta, true, botColor, newEnPassant(cells, move), tt);
            if (score < best) best = score;
            if (score < beta) beta = score;
            if (alpha >= beta) { cutoff = true; break; }
        }
    }

    // Store with the correct bound type so future lookups can use or narrow alpha/beta.
    let flag: TTEntry['flag'];
    if (!cutoff) {
        flag = 'exact';
    } else if (maximizing) {
        flag = best >= origBeta ? 'lower' : 'upper';
    } else {
        flag = best <= origAlpha ? 'upper' : 'lower';
    }
    tt.set(ttKey, { score: best, flag });

    return best;
}

/** Minimax search depth for medium and hard. Easy returns a random move before this is consulted. */
const DEPTH: Record<'medium' | 'hard', number> = { medium: 2, hard: 3 };

/**
 * Selects the best move for the bot using alpha-beta minimax.
 * On `'easy'` difficulty a random legal move is returned instead of a search.
 *
 * @param cells - Current board state.
 * @param botColor - The side the bot is playing.
 * @param enPassantTarget - En-passant landing square available this turn, or `null`.
 * @param difficulty - Search depth: `'easy'` picks randomly, `'medium'` searches 2 plies, `'hard'` 3 plies.
 * @returns The chosen `Move`, or `null` if the bot has no legal moves (checkmate or stalemate).
 */
export function getBotMove(cells: Cell[], botColor: Color, enPassantTarget: Position | null, difficulty: Difficulty,): Move | null {
    const moves = getAllMoves(cells, botColor, enPassantTarget);
    if (moves.length === 0) return null;

    if (difficulty === 'easy')
        return moves[Math.floor(Math.random() * moves.length)];

    const depth = DEPTH[difficulty as 'medium' | 'hard'];
    const tt = new Map<string, TTEntry>();
    let bestMove: Move | null = null;
    let bestScore = -Infinity;

    for (const move of moves) {
        const next = simulateMove(cells, move, enPassantTarget, botColor);
        const score = minimax(next, depth - 1, -Infinity, Infinity, false, botColor, newEnPassant(cells, move), tt);
        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    return bestMove;
}
