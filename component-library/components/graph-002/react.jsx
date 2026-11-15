// Channel Ranking · graph-002
// From the Essential Data Visualization (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

export const sampleData = {
  "labels": [
    "Organic search",
    "Direct",
    "Referral",
    "Paid social",
    "Email"
  ],
  "datasets": [
    {
      "label": "New users",
      "data": [
        24.8,
        19.3,
        13.6,
        9.8,
        6.4
      ],
      "backgroundColor": [
        "#e65b3c",
        "#272d28",
        "#272d28",
        "#272d28",
        "#272d28"
      ],
      "borderRadius": 2
    }
  ]
};

export default function ChannelRanking({
  data = sampleData,
  height = 280,
  ariaLabel = "Channel Ranking: Compare acquisition channels by new-user volume."
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const chart = new Chart(canvasRef.current, {
      type: "bar",
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: context =>
                context.dataset.label + ": " +
                context.parsed.x + "k"
            }
          }
        },
        scales: {
          x: { stacked: false, grid: { display: true } },
          y: { stacked: false, grid: { display: false },
             max: 30 }
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