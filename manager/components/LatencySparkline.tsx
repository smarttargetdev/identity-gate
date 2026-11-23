import React, { useId } from 'react';
import type { SystemHealthLevel } from '../hooks/useSystemHealth';
import type { LatencyTrendPoint } from '../types/iam';

interface LatencySparklineProps {
  points: LatencyTrendPoint[];
  level: SystemHealthLevel;
}

const COLOR_MAP: Record<SystemHealthLevel, string> = {
  healthy: '#34d399',
  degraded: '#fbbf24',
  critical: '#f87171',
  loading: '#64748b',
};

export const LatencySparkline: React.FC<LatencySparklineProps> = ({ points, level }) => {
  const gradId = useId();
  const width = 76;
  const height = 20;
  const padX = 2.5;
  const padTop = 3;
  const padBottom = 3;
  const plotHeight = height - padTop - padBottom;
  const plotWidth = width - padX * 2;

  const series =
    points.length > 0
      ? points
      : Array.from({ length: 10 }, () => ({
          minuteIso: '',
          avgLatencyMs: 0,
          maxLatencyMs: 0,
          sampleCount: 0,
        }));

  const maxLatency = Math.max(5, ...series.map((p) => p.avgLatencyMs)) * 1.1;
  const stroke = COLOR_MAP[level];

  const coords = series.map((point, index) => {
    const x =
      series.length === 1
        ? padX + plotWidth / 2
        : padX + (index / (series.length - 1)) * plotWidth;
    const clampedRatio = Math.min(1, Math.max(0, point.avgLatencyMs / maxLatency));
    const y = padTop + (1 - clampedRatio) * plotHeight;
    return { x, y, point };
  });

  const linePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const baseY = (padTop + plotHeight).toFixed(1);
  const areaPoints = `${coords[0].x.toFixed(1)},${baseY} ${linePoints} ${coords[coords.length - 1].x.toFixed(1)},${baseY}`;
  const latest = coords[coords.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-[76px] h-[20px] shrink-0 overflow-visible"
      role="img"
      aria-label="Tendência de latência dos últimos 10 minutos"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      <line
        x1={padX}
        y1={padTop + plotHeight / 2}
        x2={width - padX}
        y2={padTop + plotHeight / 2}
        stroke="#334155"
        strokeWidth="0.7"
        strokeDasharray="2 2"
      />

      <polygon points={areaPoints} fill={`url(#${gradId})`} />

      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={linePoints}
      />

      {coords.map(
        (c, idx) =>
          c.point.sampleCount > 0 &&
          idx < coords.length - 1 && (
            <circle
              key={c.point.minuteIso || idx}
              cx={c.x}
              cy={c.y}
              r="1.15"
              fill={stroke}
              fillOpacity="0.85"
            />
          )
      )}

      <circle
        cx={latest.x}
        cy={latest.y}
        r={latest.point.sampleCount > 0 ? 2 : 1.3}
        fill={stroke}
      />
    </svg>
  );
};
