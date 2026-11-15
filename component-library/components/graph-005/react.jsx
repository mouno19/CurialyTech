// Plan Mix · graph-005
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
      "label": "Starter",
      "data": [
        55,
        53,
        51,
        49,
        47,
        45
      ],
      "backgroundColor": "#dbb98b"
    },
    {
      "label": "Growth",
      "data": [
        28,
        29,
        30,
        32,
        33,
        34
      ],
      "backgroundColor": "#df6748"
    },
    {
      "label": "Enterprise",
      "data": [
        17,
        18,
        19,
        19,
        20,
        21
      ],
      "backgroundColor": "#313c38"
    }
  ]
};

export default function PlanMix({
  data = sampleData,
  height = 280,
  ariaLabel = "Plan Mix: Reveal changes in the subscription mix independent of total size."
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