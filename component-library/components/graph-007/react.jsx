// Retention Cohorts · graph-007
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
    "W6"
  ],
  "datasets": [
    {
      "label": "January",
      "data": [
        70,
        62,
        57,
        53,
        50,
        47
      ],
      "backgroundColor": "#75a8d6",
      "borderColor": "#75a8d6",
      "tension": 0.25,
      "borderWidth": 2.5,
      "pointRadius": 2
    },
    {
      "label": "February",
      "data": [
        73,
        67,
        62,
        58,
        55,
        52
      ],
      "backgroundColor": "#9d8ddd",
      "borderColor": "#9d8ddd",
      "tension": 0.25,
      "borderWidth": 2.5,
      "pointRadius": 2
    },
    {
      "label": "March",
      "data": [
        76,
        71,
        67,
        63,
        60,
        57
      ],
      "backgroundColor": "#ed8f9f",
      "borderColor": "#ed8f9f",
      "tension": 0.25,
      "borderWidth": 2.5,
      "pointRadius": 2
    }
  ]
};

export default function RetentionCohorts({
  data = sampleData,
  height = 280,
  ariaLabel = "Retention Cohorts: Compare returning-user retention across recent signup cohorts."
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
          legend: { display: true },
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
            min: 40, max: 80 }
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