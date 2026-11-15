// Circular Progress Chart · graph-035
// From the Circular Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const option = {
  "series": [
    {
      "type": "gauge",
      "startAngle": 225,
      "endAngle": -45,
      "min": 0,
      "max": 100,
      "center": [
        "50%",
        "50%"
      ],
      "radius": "77%",
      "progress": {
        "show": true,
        "width": 18,
        "roundCap": true,
        "itemStyle": {
          "color": "#d9f6ec"
        }
      },
      "axisLine": {
        "lineStyle": {
          "width": 18,
          "color": [
            [
              1,
              "#29343d"
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
        "show": false
      },
      "anchor": {
        "show": false
      },
      "detail": {
        "valueAnimation": true,
        "formatter": "{value}%",
        "fontSize": 48,
        "fontWeight": 700,
        "color": "#edf9f4",
        "offsetCenter": [
          0,
          "0%"
        ]
      },
      "title": {
        "show": true,
        "offsetCenter": [
          0,
          "30%"
        ],
        "color": "#8da6a2",
        "fontSize": 11
      },
      "data": [
        {
          "value": 76,
          "name": "COMPLETED"
        }
      ]
    }
  ]
};

export default function CircularProgressChart() {
  const container = useRef(null);
  useEffect(() => {
    const chart = echarts.init(container.current);
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, []);
  return <div ref={container} role="img" aria-label="Circular Progress Chart: Make one completion percentage immediately legible." style={{ width: '100%', height: 320 }} />;
}