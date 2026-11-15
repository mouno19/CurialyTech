// Conversion Pulse · graph-006
// From the Essential Data Visualization (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

export const sampleData = {
  "labels": [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun"
  ],
  "datasets": [
    {
      "label": "Conversion rate",
      "data": [
        9.2,
        9.8,
        9.5,
        10.9,
        11.4,
        12.8
      ],
      "backgroundColor": "#fff",
      "borderColor": "#fff",
      "tension": 0,
      "borderWidth": 3,
      "pointRadius": 4
    }
  ]
};

export default function ConversionPulse({
  data = sampleData,
  height = 280,
  ariaLabel = "Conversion Pulse: Monitor trial-to-paid conversion across the first half of the year."
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const chart = new Chart(canvasRef.current, {
      type: "line",
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "x",
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: context =>
                context.dataset.label + ": " +
                context.parsed.y + "%"
            }
          }
        },
        scales: {
          x: { stacked: false, grid: { display: false } },
          y: { stacked: false, grid: { display: true },
            min: 8, max: 14 }
        }
      }
    });
    return () => chart.destroy();
  }, [data]);

  return (
    <div role="img" aria-label={ariaLabel} style={{ height, width: "100%" }}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}