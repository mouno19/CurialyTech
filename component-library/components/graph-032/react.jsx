// Donut Chart · graph-032
// From the Circular Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const option = {
  "tooltip": {
    "trigger": "item",
    "formatter": "{b}: {c}%"
  },
  "graphic": [
    {
      "type": "text",
      "left": "center",
      "top": "38%",
      "style": {
        "text": "84K",
        "fill": "#f2f7fb",
        "font": "700 35px Manrope"
      }
    },
    {
      "type": "text",
      "left": "center",
      "top": "54%",
      "style": {
        "text": "TOTAL REACH",
        "fill": "#8da2b2",
        "font": "10px DM Mono",
        "textAlign": "center"
      }
    }
  ],
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
      "radius": [
        "49%",
        "73%"
      ],
      "center": [
        "50%",
        "45%"
      ],
      "label": {
        "show": false
      },
      "itemStyle": {
        "borderColor": "#111722",
        "borderWidth": 4,
        "borderRadius": 5
      },
      "data": [
        {
          "name": "Organic",
          "value": 44
        },
        {
          "name": "Direct",
          "value": 32
        },
        {
          "name": "Referral",
          "value": 24
        }
      ],
      "color": [
        "#73dfff",
        "#6979ec",
        "#c4a3ff"
      ]
    }
  ]
};

export default function DonutChart() {
  const container = useRef(null);
  useEffect(() => {
    const chart = echarts.init(container.current);
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, []);
  return <div ref={container} role="img" aria-label="Donut Chart: Frame composition around a prominent total." style={{ width: '100%', height: 320 }} />;
}