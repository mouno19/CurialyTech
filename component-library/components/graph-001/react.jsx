// Growth Columns · graph-001
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
      "label": "Active users",
      "data": [
        54.2,
        58.7,
        61.4,
        68.9,
        74.1,
        84.2
      ],
      "backgroundColor": [
        "#d7e1ff",
        "#d7e1ff",
        "#d7e1ff",
        "#d7e1ff",
        "#d7e1ff",
        "#635bdb"
      ],
      "borderRadius": 7
    }
  ]
};

export default function GrowthColumns({
  data = sampleData,
  height = 280,
  ariaLabel = "Growth Columns: Track monthly active users and identify growth inflection points."
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
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: context =>
                context.dataset.label + ": " +
                context.parsed.y + "k"
            }
          }
        },
        scales: {
          x: { stacked: false, grid: { display: false } },
          y: { stacked: false, grid: { display: true },
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