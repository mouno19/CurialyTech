// Force-Directed Graph · graph-049
// From the Network Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export function ForceDirectedGraph({
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
    groups.call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      }));
    simulation.on('tick', () => {
      edges.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      groups.attr('transform', d => `translate(${d.x},${d.y})`);
    });
    return () => simulation.stop();
  }, [data, width, height, colors, onSelect]);

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label="Force-Directed Graph visualization"
      style={{ width: '100%', height: 'auto', overflow: 'visible' }} />
  );
}

/** The page's own sample data, the default when no data is passed. */
export const sampleData = {
  "nodes": [
    {
      "id": "Core API",
      "group": 0
    },
    {
      "id": "Auth",
      "group": 1
    },
    {
      "id": "Billing",
      "group": 1
    },
    {
      "id": "Search",
      "group": 1
    },
    {
      "id": "Events",
      "group": 2
    },
    {
      "id": "Notifications",
      "group": 2
    },
    {
      "id": "Cache",
      "group": 3
    },
    {
      "id": "Database",
      "group": 3
    },
    {
      "id": "Observability",
      "group": 4
    },
    {
      "id": "Gateway",
      "group": 4
    }
  ],
  "links": [
    [
      "Gateway",
      "Core API"
    ],
    [
      "Core API",
      "Auth"
    ],
    [
      "Core API",
      "Billing"
    ],
    [
      "Core API",
      "Search"
    ],
    [
      "Core API",
      "Events"
    ],
    [
      "Events",
      "Notifications"
    ],
    [
      "Search",
      "Cache"
    ],
    [
      "Billing",
      "Database"
    ],
    [
      "Auth",
      "Database"
    ],
    [
      "Events",
      "Observability"
    ],
    [
      "Gateway",
      "Observability"
    ],
    [
      "Cache",
      "Database"
    ]
  ]
};

export default function ForceDirectedGraphWithData(props) {
  return <ForceDirectedGraph data={sampleData} {...props} />;
}
