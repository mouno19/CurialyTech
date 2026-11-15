// Pie Chart · graph-031
// From the Circular Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const option = {
  "tooltip": {
    "trigger": "item",
    "formatter": "{b}: {c}%"
  },
  "legend": {
    "bottom": 5,
    "icon": "circle",
    "itemWidth": 7,
    "itemHeight": 7,
    "textStyle": {
      "color": "#9fb0be",
      "fontFamily": "DM Mono",
      "fontSize": 10
    }
  },
  "series": [
    {
      "type": "pie",
      "radius": "65%",
      "center": [
        "50%",
        "44%"
      ],
      "itemStyle": {
        "borderColor": "#111722",
        "borderWidth": 3
      },
      "label": {
        "show": false
      },
      "data": [
        {
          "name": "Product",
          "value": 38
        },
        {
          "name": "Platform",
          "value": 27
        },
        {
          "name": "Research",
          "value": 20
        },
        {
          "name": "Operations",
          "value": 15
        }
      ],
      "color": [
        "#a8f0d2",
        "#6ca6c4",
        "#a788d8",
        "#e7b886"
      ]
    }
  ]
};

export default function PieChart() {
  const container = useRef(null);
  useEffect(() => {
    const chart = echarts.init(container.current);
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, []);
  return <div ref={container} role="img" aria-label="Pie Chart: Show the share of a whole across distinct categories." style={{ width: '100%', height: 320 }} />;
}