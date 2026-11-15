// Treemap · graph-041
// From the Network Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export function Treemap({
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
    d3.treemap().size([width - 40, height - 40])
      .paddingInner(4).paddingTop(20)(hierarchy);
    const groups = root.attr('transform', 'translate(20,20)')
      .selectAll('g').data(hierarchy.descendants().slice(1))
      .join('g');
    groups.each(function(d) {
      const item = d3.select(this);
      const color = colors[(d.depth === 1 ? d.parent.children.indexOf(d)
        : d.parent.parent.children.indexOf(d.parent)) % colors.length];
      choose(item.append('rect').attr('x', d.x0).attr('y', d.y0)
        .attr('width', Math.max(0, d.x1 - d.x0))
        .attr('height', Math.max(0, d.y1 - d.y0))
        .attr('rx', 5).attr('fill', color)
        .attr('fill-opacity', d.depth === 1 ? .18 : .7), d.data);
      if (d.x1 - d.x0 > 72 && d.y1 - d.y0 > 28)
        item.append('text').attr('x', d.x0 + 8).attr('y', d.y0 + 18)
          .attr('fill', '#fff').attr('font-size', 10)
          .text(d.data.name).style('pointer-events', 'none');
    });
  }, [data, width, height, colors, onSelect]);

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label="Treemap visualization"
      style={{ width: '100%', height: 'auto', overflow: 'visible' }} />
  );
}

/** The page's own sample data, the default when no data is passed. */
export const sampleData = {
  "name": "Cloud expenditure",
  "children": [
    {
      "name": "Compute",
      "children": [
        {
          "name": "Production clusters",
          "value": 42
        },
        {
          "name": "Development",
          "value": 18
        },
        {
          "name": "Batch processing",
          "value": 13
        }
      ]
    },
    {
      "name": "Storage",
      "children": [
        {
          "name": "Object storage",
          "value": 27
        },
        {
          "name": "Databases",
          "value": 23
        },
        {
          "name": "Backups",
          "value": 10
        }
      ]
    },
    {
      "name": "Network",
      "children": [
        {
          "name": "Egress",
          "value": 17
        },
        {
          "name": "CDN",
          "value": 12
        }
      ]
    },
    {
      "name": "Operations",
      "children": [
        {
          "name": "Monitoring",
          "value": 11
        },
        {
          "name": "Security",
          "value": 9
        }
      ]
    }
  ]
};

export default function TreemapWithData(props) {
  return <Treemap data={sampleData} {...props} />;
}
