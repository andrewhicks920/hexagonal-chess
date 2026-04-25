import type { Color, PieceType, Piece } from '../../game/types.ts';

interface PieceProps {
    piece: Piece;
    cx: number;
    cy: number;
    size: number;
    pieceSet: string;
    flipped?: boolean;
}

const PIECE_MAP: Record<string, string> = {
    king: 'k', queen: 'q', rook: 'r',
    bishop: 'b', knight: 'n', pawn: 'p'
};

/** Module-level cache so `new URL(...)` is only evaluated once per unique key. */
const srcCache = new Map<string, string>();

export function pieceImageSrc(color: Color, type: PieceType, pieceSet: string): string {
    const c = color === 'white' ? 'w' : 'b';
    const filename = `${c}${PIECE_MAP[type]}`;
    const key = `${pieceSet}/${filename}`;
    const cached = srcCache.get(key);
    if (cached) return cached;
    const src = new URL(`../../assets/pieces/${pieceSet}/${filename}.png`, import.meta.url).href;
    srcCache.set(key, src);
    return src;
}

export function PieceSymbol({ piece, cx, cy, size, pieceSet, flipped }: PieceProps) {
    const src = pieceImageSrc(piece.color, piece.type, pieceSet);

    return (
        <image
            href={src}
            x={cx - size}
            y={cy - size}
            width={size * 2}
            height={size * 2}
            style={{pointerEvents: 'none'}}
            transform={flipped ? `rotate(180, ${cx}, ${cy})` : undefined}
        />
    );
}
