import { useState } from 'react';
import { MoveHistory } from '../MoveHistory/MoveHistory.tsx';
import type { MoveRecord } from '../../game/types';
import type { AnalysisMoveResult } from '../../game/ai';
import './AnalysisPanel.css';

interface AnalysisPanelProps {
    topMoves: AnalysisMoveResult[];
    loading: boolean;
    moveHistory: MoveRecord[];
    canUndo: boolean;
    onUndo: () => void;
    onLoadJan: (jan: string) => void;
    onLoadPgn: (pgn: string) => void;
    onNewGame: () => void;
}

type Tab = 'analysis' | 'position';

function formatScore(score: number): string {
    const abs = Math.abs(score);
    if (abs >= 9_000) return score > 0 ? '+M' : '-M';
    const sign = score > 0.05 ? '+' : score < -0.05 ? '' : '';
    return `${sign}${score.toFixed(1)}`;
}

export function AnalysisPanel({
    topMoves,
    loading,
    moveHistory,
    canUndo,
    onUndo,
    onLoadJan,
    onLoadPgn,
    onNewGame,
}: AnalysisPanelProps) {
    const [tab, setTab] = useState<Tab>('analysis');
    const [janInput, setJanInput] = useState('');
    const [pgnInput, setPgnInput] = useState('');
    const [janError, setJanError] = useState('');
    const [pgnError, setPgnError] = useState('');

    function handleLoadJan() {
        if (!janInput.trim()) return;
        try {
            onLoadJan(janInput.trim());
            setJanError('');
            setJanInput('');
        } catch {
            setJanError('Invalid JAN string.');
        }
    }

    function handleLoadPgn() {
        if (!pgnInput.trim()) return;
        onLoadPgn(pgnInput.trim());
        setPgnError('');
        setPgnInput('');
    }

    function handleCopyPgn() {
        if (moveHistory.length === 0) return;
        const text = moveHistory
            .map(r => {
                const w = r.white ?? '';
                const b = r.black ?? '';
                return `${r.moveNumber}. ${w}${b ? ` ${b}` : ''}`;
            })
            .join(' ');
        navigator.clipboard.writeText(text).catch(() => {/* ignore */});
    }

    return (
        <>
            <div className="right-panel-tabs">
                <button
                    className={`panel-tab${tab === 'analysis' ? ' panel-tab--active' : ''}`}
                    onClick={() => setTab('analysis')}
                >
                    Analysis
                </button>
                <button
                    className={`panel-tab${tab === 'position' ? ' panel-tab--active' : ''}`}
                    onClick={() => setTab('position')}
                >
                    Position
                </button>
            </div>

            {tab === 'analysis' && (
                <div className="analysis-moves-section">
                    <div className="analysis-moves-header">Engine moves</div>
                    {loading && topMoves.length === 0 && (
                        <div className="analysis-loading">Evaluating…</div>
                    )}
                    {topMoves.length > 0 && (
                        <ol className="analysis-moves-list">
                            {topMoves.map((m, i) => (
                                <li key={i} className={`analysis-move-row${i === 0 ? ' analysis-move-row--best' : ''}`}>
                                    <span className="analysis-move-rank">{i + 1}</span>
                                    <span className="analysis-move-notation">{m.notation}</span>
                                    <span className="analysis-move-score">{formatScore(m.score)}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                    {!loading && topMoves.length === 0 && (
                        <div className="analysis-loading">No legal moves.</div>
                    )}
                </div>
            )}

            {tab === 'position' && (
                <div className="position-input-section">
                    <label className="position-label">JAN string</label>
                    <textarea
                        className="position-textarea"
                        rows={2}
                        placeholder="6/P5p/RP4pr/…"
                        value={janInput}
                        onChange={e => { setJanInput(e.target.value); setJanError(''); }}
                        spellCheck={false}
                    />
                    {janError && <span className="position-error">{janError}</span>}
                    <button className="position-btn" onClick={handleLoadJan}>Load position</button>

                    <div className="position-divider" />

                    <label className="position-label">PGN / move list</label>
                    <textarea
                        className="position-textarea"
                        rows={4}
                        placeholder={'1. e4 e5 2. Nf3 Nc6…'}
                        value={pgnInput}
                        onChange={e => { setPgnInput(e.target.value); setPgnError(''); }}
                        spellCheck={false}
                    />
                    {pgnError && <span className="position-error">{pgnError}</span>}
                    <button className="position-btn" onClick={handleLoadPgn}>Load game</button>
                    <button
                        className="position-btn position-btn--secondary"
                        onClick={handleCopyPgn}
                        disabled={moveHistory.length === 0}
                    >
                        Copy current game
                    </button>
                </div>
            )}

            <MoveHistory moves={moveHistory} />

            <div className="panel-controls">
                <div className="analysis-control-row">
                    <button
                        className="undo-btn"
                        onClick={onUndo}
                        disabled={!canUndo}
                        title="Undo last move (analysis mode)"
                    >
                        ↩ Undo
                    </button>
                    <button className="new-game-btn" onClick={onNewGame}>+ New</button>
                </div>
            </div>
        </>
    );
}
