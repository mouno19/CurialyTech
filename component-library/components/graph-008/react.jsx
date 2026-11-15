// Revenue Trajectory · graph-008
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
      "label": "MRR",
      "data": [
        323,
        351,
        381,
        411,
        448,
        482
      ],
      "backgroundColor": "rgba(38,119,152,.18)",
      "borderColor": "#267798",
      "fill": true,
      "tension": 0.25,
      "borderWidth": 3,
      "pointRadius": 3
    }
  ]
};

export default function RevenueTrajectory({
  data = sampleData,
  height = 280,
  ariaLabel = "Revenue Trajectory: Present recurring-revenue growth with a clear trend silhouette."
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
                "$" + context.parsed.y + "k"
            }
          }
        },
        scales: {
          x: { stacked: false, grid: { display: false } },
          y: { stacked: false, grid: { display: true },
            min: 250, max: 550 }
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