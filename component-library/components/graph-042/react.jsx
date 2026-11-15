// Sunburst Chart · graph-042
// From the Network Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export function SunburstChart({
  data,
  width = 900,
  height = 430,
  colors = ["#5ce2e6","#aa91ff","#bcf07a","#ffbf75","#f18fba","#79adff"],
  onSelect = () => {}
}) {
  const ref = useRef(null);

  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll('*').remove();
    const root = svg.append('g');
    const choose = (selection, datum) => selection
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', datum.name || datum.id || 'Relationship')
      .on('click', () => onSelect(datum))
      .on('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(datum);
        }
      });
    const hierarchy = d3.hierarchy(data).sum(d => d.value || 0);
    const radius = Math.min(width, height) / 2 - 20;
    d3.partition().size([2 * Math.PI, radius])(hierarchy);
    const arc = d3.arc().startAngle(d => d.x0).endAngle(d => d.x1)
      .padAngle(.01).innerRadius(d => d.y0 + 4)
      .outerRadius(d => d.y1 - 3);
    const layer = root.attr('transform', `translate(${width/2},${height/2})`);
    layer.selectAll('path').data(hierarchy.descendants().slice(1))
      .join('path').attr('d', arc)
      .attr('fill', d => colors[(d.depth === 1
        ? hierarchy.children.indexOf(d)
        : hierarchy.children.indexOf(d.parent)) % colors.length])
      .attr('stroke', '#0a1424')
      .each(function(d) { choose(d3.select(this), d.data); });
  }, [data, width, height, colors, onSelect]);

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label="Sunburst Chart visualization"
      style={{ width: '100%', height: 'auto', overflow: 'visible' }} />
  );
}

/** The page's own sample data, the default when no data is passed. */
export const sampleData = {
  "name": "Identity platform",
  "children": [
    {
      "name": "Employees",
      "children": [
        {
          "name": "SSO",
          "value": 3400
        },
        {
          "name": "MFA",
          "value": 2700
        },
        {
          "name": "Privileged",
          "value": 420
        }
      ]
    },
    {
      "name": "Partners",
      "children": [
        {
          "name": "Federated",
          "value": 1800
        },
        {
          "name": "API access",
          "value": 950
        }
      ]
    },
    {
      "name": "Customers",
      "children": [
        {
          "name": "Web accounts",
          "value": 5200
        },
        {
          "name": "Mobile accounts",
          "value": 4100
        }
      ]
    },
    {
      "name": "Service accounts",
      "children": [
        {
          "name": "Automations",
          "value": 650
        },
        {
          "name": "Integrations",
          "value": 320
        }
      ]
    }
  ]
};

export default function SunburstChartWithData(props) {
  return <SunburstChart data={sampleData} {...props} />;
}
