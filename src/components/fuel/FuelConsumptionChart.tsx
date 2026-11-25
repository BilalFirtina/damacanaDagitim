import React, { useMemo } from 'react';
import type { FuelPlateSeries } from '../../services/fuelRules';

const dateLabel = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString('tr-TR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
  });

const numberLabel = (value: number): string =>
  value.toLocaleString('tr-TR', { maximumFractionDigits: 1 });

interface FuelConsumptionChartProps {
  series: FuelPlateSeries[];
}

export const FuelConsumptionChart: React.FC<FuelConsumptionChartProps> = ({
  series,
}) => {
  const model = useMemo(() => {
    const allPoints = series.flatMap((item) => item.points);
    if (allPoints.length === 0) return null;

    let minTime = Math.min(...allPoints.map((point) => point.timestamp));
    let maxTime = Math.max(...allPoints.map((point) => point.timestamp));
    if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) return null;
    if (minTime === maxTime) {
      minTime -= 86400000;
      maxTime += 86400000;
    }

    const maxValue = Math.max(...allPoints.map((point) => point.value), 1);
    const yMax = Math.max(10, Math.ceil(maxValue / 5) * 5);

    return { minTime, maxTime, yMax };
  }, [series]);

  if (!model) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-xs text-slate-500">
        Tüketim grafiği için en az 2 yakıt alımı gerekir.
      </div>
    );
  }

  const width = 900;
  const height = 360;
  const margin = { top: 20, right: 24, bottom: 52, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const xOf = (timestamp: number) =>
    margin.left +
    ((timestamp - model.minTime) / (model.maxTime - model.minTime)) * plotWidth;
  const yOf = (value: number) =>
    margin.top + plotHeight - (value / model.yMax) * plotHeight;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => model.yMax * ratio);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(
    (ratio) => model.minTime + (model.maxTime - model.minTime) * ratio
  );

  return (
    <div className="space-y-3 w-full min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {series.map((item) => (
          <span
            key={item.plate}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="font-semibold">{item.plate}</span>
            <span className="text-slate-400">
              {item.hasData
                ? `· ${item.overallAverage !== null ? `${numberLabel(item.overallAverage)} L/100 km` : '—'}`
                : '· Veri yok'}
            </span>
          </span>
        ))}
      </div>

      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          role="img"
          aria-label="Araçların 100 kilometrede ortalama yakıt tüketimi"
        >
          {yTicks.map((value) => (
            <g key={`y-${value}`}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={yOf(value)}
                y2={yOf(value)}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={margin.left - 10}
                y={yOf(value) + 4}
                textAnchor="end"
                fontSize="12"
                fill="#64748b"
              >
                {numberLabel(value)}
              </text>
            </g>
          ))}

          {xTicks.map((timestamp) => (
            <g key={`x-${timestamp}`}>
              <line
                x1={xOf(timestamp)}
                x2={xOf(timestamp)}
                y1={margin.top}
                y2={margin.top + plotHeight}
                stroke="#f1f5f9"
                strokeWidth="1"
              />
              <text
                x={xOf(timestamp)}
                y={height - 22}
                textAnchor="middle"
                fontSize="12"
                fill="#64748b"
              >
                {dateLabel(timestamp)}
              </text>
            </g>
          ))}

          <text
            x={margin.left - 48}
            y={margin.top + plotHeight / 2}
            textAnchor="middle"
            fontSize="12"
            fill="#64748b"
            transform={`rotate(-90 ${margin.left - 48} ${margin.top + plotHeight / 2})`}
          >
            L/100 km
          </text>

          {series.map((item) => {
            const points = item.points;
            if (points.length === 0) return null;
            const path = points
              .map(
                (point, index) =>
                  `${index === 0 ? 'M' : 'L'} ${xOf(point.timestamp)} ${yOf(point.value)}`
              )
              .join(' ');
            return (
              <g key={item.plate}>
                {points.length > 1 && (
                  <path
                    d={path}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {points.map((point) => (
                  <circle
                    key={point.entryId}
                    cx={xOf(point.timestamp)}
                    cy={yOf(point.value)}
                    r="4"
                    fill="#ffffff"
                    stroke={item.color}
                    strokeWidth="2.5"
                  >
                    <title>{`${numberLabel(point.value)} L/100 km`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
