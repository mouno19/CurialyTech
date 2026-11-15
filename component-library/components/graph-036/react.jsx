// Gauge Chart · graph-036
// From the Circular Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const option = {
  "series": [
    {
      "type": "gauge",
      "center": [
        "50%",
        "53%"
      ],
      "radius": "77%",
      "min": 0,
      "max": 100,
      "axisLine": {
        "lineStyle": {
          "width": 13,
          "color": [
            [
              0.4,
              "#425e6b"
            ],
            [
              0.75,
              "#74bac3"
            ],
            [
              1,
              "#f4ca87"
            ]
          ]
        }
      },
      "pointer": {
        "length": "58%",
        "width": 5,
        "itemStyle": {
          "color": "#f4ca87"
        }
      },
      "anchor": {
        "show": true,
        "size": 12,
        "itemStyle": {
          "color": "#f4ca87"
        }
      },
      "axisTick": {
        "distance": -20,
        "length": 4,
        "lineStyle": {
          "color": "#8a9aa7"
        }
      },
      "splitLine": {
        "distance": -23,
        "length": 9,
        "lineStyle": {
          "color": "#aab7c0"
        }
      },
      "axisLabel": {
        "distance": 20,
        "color": "#8fa0ad",
        "fontSize": 10
      },
      "detail": {
        "formatter": "{value}",
        "fontSize": 35,
        "color": "#f7e1ba",
        "offsetCenter": [
          0,
          "65%"
        ]
      },
      "title": {
        "show": false
      },
      "data": [
        {
          "value": 83
        }
      ]
    }
  ]
};

export default function GaugeChart() {
  const container = useRef(null);
  useEffect(() => {
    const chart = echarts.init(container.current);
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, []);
  return <div ref={container} role="img" aria-label="Gauge Chart: Locate a live score against a calibrated performance range." style={{ width: '100%', height: 320 }} />;
}