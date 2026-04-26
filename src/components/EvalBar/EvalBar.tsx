import './EvalBar.css';

interface EvalBarProps {
    /** Position evaluation in pawn units from white's perspective. */
    score: number;
    loading: boolean;
}

export function EvalBar({ score, loading }: EvalBarProps) {
    // Clamp to ±10 for display; checkmate scores (±10 000) snap to the edge.
    const clamped = Math.max(-10, Math.min(10, score));

    // Percentage from the top that is "black's" section (0% = all white, 100% = all black).
    const blackPct = 50 - (clamped / 10) * 50;

    const absScore = Math.abs(score);
    const isMate   = absScore >= 9_000;
    let label: string;

    if (loading) {
        label = '…';
    } else if (isMate) {
        label = score > 0 ? 'M' : '-M';
    } else {
        const sign = score > 0.05 ? '+' : '';
        label = `${sign}${score.toFixed(1)}`;
    }

    return (
        <div className="eval-bar" title={`Evaluation: ${label}`}>
            <div className="eval-bar-track">
                <div className="eval-bar-black" style={{ height: `${blackPct}%` }} />
            </div>
            <span className="eval-bar-label">{label}</span>
        </div>
    );
}
