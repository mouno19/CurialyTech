// Polar Area Chart · graph-038
// From the Circular Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const option = {
  "tooltip": {
    "trigger": "item",
    "formatter": "{b}: {c}"
  },
  "series": [
    {
      "type": "pie",
      "roseType": "radius",
      "radius": [
        "13%",
        "75%"
      ],
      "center": [
        "50%",
        "50%"
      ],
      "startAngle": 90,
      "label": {
        "show": true,
        "position": "outside",
        "color": "#b1bac8",
        "fontFamily": "DM Mono",
        "fontSize": 11
      },
      "labelLine": {
        "lineStyle": {
          "color": "#657482"
        }
      },
      "itemStyle": {
        "borderColor": "#111722",
        "borderWidth": 3
      },
      "data": [
        {
          "name": "A",
          "value": 30
        },
        {
          "name": "B",
          "value": 48
        },
        {
          "name": "C",
          "value": 65
        },
        {
          "name": "D",
          "value": 42
        },
        {
          "name": "E",
          "value": 78
        },
        {
          "name": "F",
          "value": 55
        }
      ],
      "color": [
        "#f3b79c",
        "#ec8e9a",
        "#cf8cb6",
        "#ae9bcf",
        "#8aaacf",
        "#8fc9c2"
      ]
    }
  ]
};

export default function PolarAreaChart() {
  const container = useRef(null);
  useEffect(() => {
    const chart = echarts.init(container.current);
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, []);
  return <div ref={container} role="img" aria-label="Polar Area Chart: Compare categories using equal-angle radial areas." style={{ width: '100%', height: 320 }} />;
}