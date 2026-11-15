// Revenue Layers · graph-004
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
        72,
        76,
        79,
        83,
        88,
        91
      ],
      "backgroundColor": "#218eac"
    },
    {
      "label": "Growth",
      "data": [
        135,
        146,
        158,
        170,
        184,
        198
      ],
      "backgroundColor": "#57d9d0"
    },
    {
      "label": "Enterprise",
      "data": [
        116,
        129,
        144,
        158,
        176,
        193
      ],
      "backgroundColor": "#a993f3",
      "borderRadius": 4
    }
  ]
};

export default function RevenueLayers({
  data = sampleData,
  height = 280,
  ariaLabel = "Revenue Layers: Show the composition of subscription revenue over time."
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
                "$" + context.parsed.y + "k"
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { display: true },
             max: 550 }
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