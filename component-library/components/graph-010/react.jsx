// Engagement Flow · graph-010
// From the Essential Data Visualization (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

export const sampleData = {
  "labels": [
    "W1",
    "W2",
    "W3",
    "W4",
    "W5",
    "W6",
    "W7",
    "W8"
  ],
  "datasets": [
    {
      "label": "Sessions per user",
      "data": [
        3.6,
        4.1,
        3.9,
        4.7,
        4.5,
        5.2,
        5,
        5.8
      ],
      "backgroundColor": "#f0a8ce",
      "borderColor": "#f0a8ce",
      "tension": 0.46,
      "borderWidth": 4,
      "pointRadius": 3
    }
  ]
};

export default function EngagementFlow({
  data = sampleData,
  height = 280,
  ariaLabel = "Engagement Flow: Emphasize the organic trajectory of weekly product engagement."
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
                context.parsed.y + ""
            }
          }
        },
        scales: {
          x: { stacked: false, grid: { display: false } },
          y: { stacked: false, grid: { display: true },
            min: 3, max: 6.5 }
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