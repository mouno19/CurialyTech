// Dependency Graph · graph-050
// From the Network Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export function DependencyGraph({
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
    const positions = new Map();
    const tiers = d3.group(nodes, d => d.layer);
    tiers.forEach((items, tier) => items.forEach((d, i) =>
      positions.set(d.id, [
        100 + tier * (width - 200) / Math.max(1, tiers.size - 1),
        height / 2 + (i - (items.length - 1) / 2) * 85
      ])
    ));
    const defs = root.append('defs');
    defs.append('marker').attr('id', 'dependency-arrow')
      .attr('markerWidth', 8).attr('markerHeight', 8)
      .attr('refX', 8).attr('refY', 4).attr('orient', 'auto')
      .append('path').attr('d', 'M0,0 L8,4 L0,8 Z')
      .attr('fill', '#8ca8b8');
    root.selectAll('line').data(data.links).join('line')
      .attr('x1', d => positions.get(d[0])[0] + 14)
      .attr('y1', d => positions.get(d[0])[1])
      .attr('x2', d => positions.get(d[1])[0] - 14)
      .attr('y2', d => positions.get(d[1])[1])
      .attr('stroke', '#63889c')
      .attr('marker-end', 'url(#dependency-arrow)');
    const layer = root.selectAll('g.node').data(nodes).join('g')
      .attr('transform', d => `translate(${positions.get(d.id)})`);
    layer.each(function(d) {
      const node = d3.select(this);
      choose(node.append('circle').attr('r', 14)
        .attr('fill', colors[d.layer % colors.length]), d);
      node.append('text').attr('y', 32)
        .attr('text-anchor', 'middle').attr('fill', '#e8f5ff')
        .attr('font-size', 10).text(d.id);
    });
  }, [data, width, height, colors, onSelect]);

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label="Dependency Graph visualization"
      style={{ width: '100%', height: 'auto', overflow: 'visible' }} />
  );
}

/** The page's own sample data, the default when no data is passed. */
export const sampleData = {
  "nodes": [
    {
      "id": "Application",
      "layer": 0
    },
    {
      "id": "UI library",
      "layer": 1
    },
    {
      "id": "Auth SDK",
      "layer": 1
    },
    {
      "id": "API client",
      "layer": 1
    },
    {
      "id": "Design tokens",
      "layer": 2
    },
    {
      "id": "Session service",
      "layer": 2
    },
    {
      "id": "HTTP transport",
      "layer": 2
    },
    {
      "id": "Telemetry",
      "layer": 3
    },
    {
      "id": "Runtime",
      "layer": 3
    }
  ],
  "links": [
    [
      "Application",
      "UI library"
    ],
    [
      "Application",
      "Auth SDK"
    ],
    [
      "Application",
      "API client"
    ],
    [
      "UI library",
      "Design tokens"
    ],
    [
      "Auth SDK",
      "Session service"
    ],
    [
      "API client",
      "HTTP transport"
    ],
    [
      "Session service",
      "Telemetry"
    ],
    [
      "HTTP transport",
      "Telemetry"
    ],
    [
      "Telemetry",
      "Runtime"
    ]
  ]
};

export default function DependencyGraphWithData(props) {
  return <DependencyGraph data={sampleData} {...props} />;
}
