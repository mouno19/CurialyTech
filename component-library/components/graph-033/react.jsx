// Nested Donut Chart · graph-033
// From the Circular Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const option = {
  "tooltip": {
    "trigger": "item"
  },
  "graphic": [
    {
      "type": "text",
      "left": "center",
      "top": "43%",
      "style": {
        "text": "Q3",
        "fill": "#e8eef3",
        "font": "700 24px Manrope"
      }
    }
  ],
  "legend": {
    "bottom": 3,
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
        "30%",
        "40%"
      ],
      "center": [
        "50%",
        "43%"
      ],
      "startAngle": 90,
      "silent": true,
      "label": {
        "show": false
      },
      "data": [
        {
          "value": 82,
          "name": "Core",
          "itemStyle": {
            "color": "#b8f3cc",
            "borderRadius": 6
          }
        },
        {
          "value": 18,
          "name": "Remaining",
          "itemStyle": {
            "color": "#283340"
          }
        }
      ]
    },
    {
      "type": "pie",
      "radius": [
        "46%",
        "56%"
      ],
      "center": [
        "50%",
        "43%"
      ],
      "startAngle": 90,
      "silent": true,
      "label": {
        "show": false
      },
      "data": [
        {
          "value": 64,
          "name": "Growth",
          "itemStyle": {
            "color": "#b9aeff",
            "borderRadius": 6
          }
        },
        {
          "value": 36,
          "name": "Remaining",
          "itemStyle": {
            "color": "#283340"
          }
        }
      ]
    },
    {
      "type": "pie",
      "radius": [
        "62%",
        "72%"
      ],
      "center": [
        "50%",
        "43%"
      ],
      "startAngle": 90,
      "silent": true,
      "label": {
        "show": false
      },
      "data": [
        {
          "value": 46,
          "name": "Labs",
          "itemStyle": {
            "color": "#ffae9d",
            "borderRadius": 6
          }
        },
        {
          "value": 54,
          "name": "Remaining",
          "itemStyle": {
            "color": "#283340"
          }
        }
      ]
    }
  ]
};

export default function NestedDonutChart() {
  const container = useRef(null);
  useEffect(() => {
    const chart = echarts.init(container.current);
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, []);
  return <div ref={container} role="img" aria-label="Nested Donut Chart: Compare three related completion rates without mixing their scales." style={{ width: '100%', height: 320 }} />;
}