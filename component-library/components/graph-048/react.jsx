// Network Graph · graph-048
// From the Network Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export function NetworkGraph({
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
    const nodes = data.nodes.map(d => ({ ...d }));
    const links = data.links.map(([source, target]) =>
      ({ source, target }));
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(110))
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(35));
    const edges = root.selectAll('line').data(links).join('line')
      .attr('stroke', '#63889c').attr('stroke-opacity', .7);
    const groups = root.selectAll('g.node').data(nodes).join('g');
    groups.each(function(d) {
      const group = d3.select(this);
      choose(group.append('circle').attr('r', 16)
        .attr('fill', colors[d.group % colors.length])
        .attr('stroke', '#fff'), d);
      group.append('text').attr('y', 31)
        .attr('text-anchor', 'middle').attr('fill', '#e8f5ff')
        .attr('font-size', 10).text(d.id);
    });
    
    simulation.on('tick', () => {
      edges.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      groups.attr('transform', d => `translate(${d.x},${d.y})`);
    });
    return () => simulation.stop();
  }, [data, width, height, colors, onSelect]);

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label="Network Graph visualization"
      style={{ width: '100%', height: 'auto', overflow: 'visible' }} />
  );
}

/** The page's own sample data, the default when no data is passed. */
export const sampleData = {
  "nodes": [
    {
      "id": "Zero trust",
      "group": 0
    },
    {
      "id": "Identity",
      "group": 1
    },
    {
      "id": "Endpoint",
      "group": 1
    },
    {
      "id": "Network",
      "group": 1
    },
    {
      "id": "Policy engine",
      "group": 2
    },
    {
      "id": "Telemetry",
      "group": 2
    },
    {
      "id": "Device posture",
      "group": 3
    },
    {
      "id": "MFA",
      "group": 3
    },
    {
      "id": "SIEM",
      "group": 4
    }
  ],
  "links": [
    [
      "Zero trust",
      "Identity"
    ],
    [
      "Zero trust",
      "Endpoint"
    ],
    [
      "Zero trust",
      "Network"
    ],
    [
      "Identity",
      "MFA"
    ],
    [
      "Identity",
      "Policy engine"
    ],
    [
      "Endpoint",
      "Device posture"
    ],
    [
      "Endpoint",
      "Telemetry"
    ],
    [
      "Network",
      "Telemetry"
    ],
    [
      "Policy engine",
      "Telemetry"
    ],
    [
      "Telemetry",
      "SIEM"
    ],
    [
      "Policy engine",
      "SIEM"
    ]
  ]
};

export default function NetworkGraphWithData(props) {
  return <NetworkGraph data={sampleData} {...props} />;
}
