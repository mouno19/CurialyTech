// Nightingale Rose Chart · graph-039
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
      "roseType": "area",
      "radius": [
        "8%",
        "76%"
      ],
      "center": [
        "50%",
        "50%"
      ],
      "startAngle": 90,
      "label": {
        "show": false
      },
      "itemStyle": {
        "borderColor": "#111722",
        "borderWidth": 3,
        "borderRadius": 4
      },
      "data": [
        {
          "name": "01",
          "value": 22
        },
        {
          "name": "02",
          "value": 35
        },
        {
          "name": "03",
          "value": 48
        },
        {
          "name": "04",
          "value": 58
        },
        {
          "name": "05",
          "value": 74
        },
        {
          "name": "06",
          "value": 62
        },
        {
          "name": "07",
          "value": 43
        },
        {
          "name": "08",
          "value": 29
        }
      ],
      "color": [
        "#416e8b",
        "#4d879d",
        "#61a7aa",
        "#81c9aa",
        "#b7dda6",
        "#d7ce93",
        "#c9a582",
        "#947d88"
      ]
    }
  ]
};

export default function NightingaleRoseChart() {
  const container = useRef(null);
  useEffect(() => {
    const chart = echarts.init(container.current);
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, []);
  return <div ref={container} role="img" aria-label="Nightingale Rose Chart: Reveal the rhythm of a multi-category distribution." style={{ width: '100%', height: 320 }} />;
}