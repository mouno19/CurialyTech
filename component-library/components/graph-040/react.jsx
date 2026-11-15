// Radial Timeline · graph-040
// From the Circular Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const option = {
  "polar": {
    "radius": "62%",
    "center": [
      "50%",
      "50%"
    ]
  },
  "angleAxis": {
    "type": "category",
    "data": [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC"
    ],
    "startAngle": 90,
    "clockwise": true,
    "axisLabel": {
      "color": "#8194a2",
      "fontSize": 9,
      "interval": 2
    },
    "axisLine": {
      "lineStyle": {
        "color": "#496257",
        "width": 2
      }
    },
    "axisTick": {
      "show": false
    }
  },
  "radiusAxis": {
    "min": 0,
    "max": 10,
    "axisLabel": {
      "show": false
    },
    "axisLine": {
      "show": false
    },
    "axisTick": {
      "show": false
    },
    "splitLine": {
      "lineStyle": {
        "color": "#26343b",
        "type": "dashed"
      }
    }
  },
  "tooltip": {},
  "series": [
    {
      "type": "scatter",
      "coordinateSystem": "polar",
      "symbolSize": 16,
      "data": [
        {
          "name": "Discover",
          "value": [
            8,
            0
          ],
          "itemStyle": {
            "color": "#a8f0d2",
            "borderColor": "#111722",
            "borderWidth": 3
          }
        },
        {
          "name": "Prototype",
          "value": [
            8,
            3
          ],
          "itemStyle": {
            "color": "#77d9d9",
            "borderColor": "#111722",
            "borderWidth": 3
          }
        },
        {
          "name": "Launch",
          "value": [
            8,
            6
          ],
          "itemStyle": {
            "color": "#c4a8ff",
            "borderColor": "#111722",
            "borderWidth": 3
          }
        },
        {
          "name": "Review",
          "value": [
            8,
            9
          ],
          "itemStyle": {
            "color": "#f0bd8e",
            "borderColor": "#111722",
            "borderWidth": 3
          }
        }
      ],
      "label": {
        "show": true,
        "position": "top",
        "formatter": "{b}",
        "color": "#d7e4e4",
        "fontSize": 10
      }
    }
  ],
  "graphic": [
    {
      "type": "text",
      "left": "center",
      "top": "46%",
      "style": {
        "text": "2026",
        "fill": "#e0efe7",
        "font": "700 25px Manrope"
      }
    }
  ]
};

export default function RadialTimeline() {
  const container = useRef(null);
  useEffect(() => {
    const chart = echarts.init(container.current);
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, []);
  return <div ref={container} role="img" aria-label="Radial Timeline: Place milestones around a repeating annual cycle." style={{ width: '100%', height: 320 }} />;
}