import type { Color } from '../../game/types';

interface PlayerAvatarProps {
    color: Color;
    /** CSS class applied to the SVG element (e.g. "player-avatar"). */
    className?: string;
    width?: number;
    height?: number;
}

/** Player silhouette avatar — shared between GamePage panels and BotSetup. */
export function PlayerAvatar({ color, className, width, height }: PlayerAvatarProps) {
    const bg = color === 'white' ? '#9f9689' : '#555353';
    const fg = color === 'white' ? '#d4ccc4' : '#3a3838';
    return (
        <svg
            className={className}
            viewBox="0 0 40 40"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
        >
            <rect width="40" height="40" rx="4" fill={bg} />
            <ellipse cx="20" cy="15" rx="8" ry="9" fill={fg} />
            <ellipse cx="20" cy="38" rx="15" ry="12" fill={fg} />
        </svg>
    );
}
