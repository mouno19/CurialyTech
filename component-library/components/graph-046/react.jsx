// Sankey Diagram · graph-046
// From the Network Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';

export function SankeyDiagram({
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
    const layout = sankey().nodeWidth(14).nodePadding(20)
      .nodeId(d => d.name)
      .extent([[85, 45], [width - 85, height - 45]]);
    const graph = layout({
      nodes: data.nodes.map(d => ({ ...d })),
      links: data.links.map(d => ({
        ...d,
        source: data.nodes[d.source].name,
        target: data.nodes[d.target].name
      }))
    });
    root.selectAll('path').data(graph.links).join('path')
      .attr('d', sankeyLinkHorizontal()).attr('fill', 'none')
      .attr('stroke', d => colors[d.source.index % colors.length])
      .attr('stroke-opacity', .45).attr('stroke-width', d => d.width)
      .each(function(d) { choose(d3.select(this), d); });
    root.selectAll('rect').data(graph.nodes).join('rect')
      .attr('x', d => d.x0).attr('y', d => d.y0)
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)
      .attr('fill', d => colors[d.index % colors.length])
      .each(function(d) { choose(d3.select(this), d); });
    root.selectAll('text').data(graph.nodes).join('text')
      .attr('x', d => d.x0 < width / 2 ? d.x1 + 7 : d.x0 - 7)
      .attr('y', d => (d.y0 + d.y1) / 2)
      .attr('text-anchor', d => d.x0 < width / 2 ? 'start' : 'end')
      .attr('fill', '#e8f5ff').attr('font-size', 10)
      .text(d => d.name);
  }, [data, width, height, colors, onSelect]);

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label="Sankey Diagram visualization"
      style={{ width: '100%', height: 'auto', overflow: 'visible' }} />
  );
}

/** The page's own sample data, the default when no data is passed. */
export const sampleData = {
  "nodes": [
    {
      "name": "Web"
    },
    {
      "name": "Mobile"
    },
    {
      "name": "Partners"
    },
    {
      "name": "API gateway"
    },
    {
      "name": "Identity"
    },
    {
      "name": "Payments"
    },
    {
      "name": "Analytics"
    },
    {
      "name": "Data warehouse"
    }
  ],
  "links": [
    {
      "source": 0,
      "target": 3,
      "value": 45
    },
    {
      "source": 1,
      "target": 3,
      "value": 35
    },
    {
      "source": 2,
      "target": 3,
      "value": 20
    },
    {
      "source": 3,
      "target": 4,
      "value": 38
    },
    {
      "source": 3,
      "target": 5,
      "value": 27
    },
    {
      "source": 3,
      "target": 6,
      "value": 35
    },
    {
      "source": 4,
      "target": 7,
      "value": 38
    },
    {
      "source": 5,
      "target": 7,
      "value": 27
    },
    {
      "source": 6,
      "target": 7,
      "value": 35
    }
  ]
};

export default function SankeyDiagramWithData(props) {
  return <SankeyDiagram data={sampleData} {...props} />;
}
