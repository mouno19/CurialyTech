// Activation Split · graph-003
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
      "label": "Desktop",
      "data": [
        58,
        61,
        64,
        65,
        69,
        72
      ],
      "backgroundColor": "#5784e8",
      "borderRadius": 5
    },
    {
      "label": "Mobile",
      "data": [
        43,
        46,
        48,
        53,
        56,
        61
      ],
      "backgroundColor": "#bbd1fa",
      "borderRadius": 5
    }
  ]
};

export default function ActivationSplit({
  data = sampleData,
  height = 280,
  ariaLabel = "Activation Split: Compare trial activation across desktop and mobile cohorts."
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const chart = new Chart(canvasRef.current, {
      type: "bar",
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
             max: 80 }
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