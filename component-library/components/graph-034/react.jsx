// Radial Bar Chart · graph-034
// From the Circular Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const option = {
  "polar": {
    "radius": "67%",
    "center": [
      "50%",
      "49%"
    ]
  },
  "angleAxis": {
    "type": "category",
    "data": [
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
      "SAT"
    ],
    "axisLabel": {
      "color": "#a8b8c5",
      "fontSize": 10
    },
    "axisLine": {
      "show": false
    },
    "axisTick": {
      "show": false
    },
    "startAngle": 90
  },
  "radiusAxis": {
    "min": 0,
    "max": 100,
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
        "color": "#293644"
      }
    }
  },
  "tooltip": {
    "trigger": "item"
  },
  "series": [
    {
      "type": "bar",
      "coordinateSystem": "polar",
      "roundCap": true,
      "barWidth": 15,
      "data": [
        72,
        89,
        63,
        95,
        81,
        56
      ],
      "itemStyle": {
        "color": "#7ad8ff",
        "opacity": 0.9
      }
    }
  ]
};

export default function RadialBarChart() {
  const container = useRef(null);
  useEffect(() => {
    const chart = echarts.init(container.current);
    chart.setOption(option);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, []);
  return <div ref={container} role="img" aria-label="Radial Bar Chart: Rank categories while keeping a shared radial scale." style={{ width: '100%', height: 320 }} />;
}