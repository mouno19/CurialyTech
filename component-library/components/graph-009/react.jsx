// User Base Composition · graph-009
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
      "label": "New",
      "data": [
        18,
        19,
        20,
        22,
        23,
        25
      ],
      "backgroundColor": "#eeff3b",
      "borderColor": "#111111",
      "fill": "-1",
      "tension": 0.25,
      "borderWidth": 1.5,
      "pointRadius": 0
    },
    {
      "label": "Returning",
      "data": [
        27,
        29,
        30,
        33,
        36,
        40
      ],
      "backgroundColor": "#b5b9b1",
      "borderColor": "#111111",
      "fill": "-1",
      "tension": 0.25,
      "borderWidth": 1.5,
      "pointRadius": 0
    },
    {
      "label": "Power",
      "data": [
        9,
        11,
        11,
        14,
        15,
        19
      ],
      "backgroundColor": "#272727",
      "borderColor": "#111111",
      "fill": "-1",
      "tension": 0.25,
      "borderWidth": 1.5,
      "pointRadius": 0
    }
  ]
};

export default function UserBaseComposition({
  data = sampleData,
  height = 280,
  ariaLabel = "User Base Composition: Understand how new, returning, and power users contribute to activity."
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
                context.parsed.y + "k"
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { display: true },
             max: 100 }
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