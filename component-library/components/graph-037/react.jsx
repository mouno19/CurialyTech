// Semi-Circular Gauge · graph-037
// From the Circular Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const option = {
  "series": [
    {
      "type": "gauge",
      "startAngle": 180,
      "endAngle": 0,
      "center": [
        "50%",
        "70%"
      ],
      "radius": "95%",
      "min": 0,
      "max": 120,
      "progress": {
        "show": true,
        "width": 20,
        "roundCap": true,
        "itemStyle": {
          "color": "#b7a9ff"
        }
      },
      "axisLine": {
        "lineStyle": {
          "width": 20,
          "color": [
            [
              1,
              "#303248"
            ]
          ]
        }
      },
      "pointer": {
        "show": false
      },
      "axisTick": {
        "show": false
      },
      "splitLine": {
        "show": false
      },
      "axisLabel": {
        "color": "#a4a3bb",
        "distance": 28,
        "fontSize": 11
      },
      "detail": {
        "formatter": "{value}",
        "fontSize": 44,
        "color": "#e9e4ff",
        "offsetCenter": [
          0,
          "-12%"
        ]
      },
      "title": {
        "offsetCenter": [
          0,
          "18%"
        ],
        "fontSize": 10,
        "color": "#a7a0c9"
      },
      "data": [
        {
          "value": 92,
          "name": "CAPACITY / 120"
        }
      ]
    }
  ]
};

export default function SemiCircularGauge() {
  const container = useRef(null);
  useEffect(() => {
    const chart = echarts.init(container.current);
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, []);
  return <div ref={container} role="img" aria-label="Semi-Circular Gauge: Display capacity in a space-efficient half-dial." style={{ width: '100%', height: 320 }} />;
}