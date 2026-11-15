// Organization Chart · graph-045
// From the Network Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export function OrganizationChart({
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
    const hierarchy = d3.hierarchy(data);
    const vertical = true;
    d3.tree().size(vertical
      ? [width - 130, height - 110]
      : [height - 90, width - 180])(hierarchy);
    const point = d => vertical ? [d.x + 65, d.y + 55]
      : [d.y + 90, d.x + 45];
    root.selectAll('path').data(hierarchy.links()).join('path')
      .attr('d', d => {
        const [sx, sy] = point(d.source), [tx, ty] = point(d.target);
        return vertical
          ? `M${sx},${sy} V${(sy+ty)/2} H${tx} V${ty}`
          : `M${sx},${sy} H${(sx+tx)/2} V${ty} H${tx}`;
      }).attr('fill', 'none').attr('stroke', '#63889c');
    const nodes = root.selectAll('g.node')
      .data(hierarchy.descendants()).join('g')
      .attr('transform', d => `translate(${point(d)})`);
    nodes.each(function(d) {
      const node = d3.select(this);
      choose(node.append('circle').attr('r', 10)
        .attr('fill', colors[d.depth % colors.length]), d.data);
      node.append('text').attr('x', vertical ? 0 : 16)
        .attr('y', vertical ? -16 : 4)
        .attr('text-anchor', vertical ? 'middle' : 'start')
        .attr('fill', '#e8f5ff').attr('font-size', 10)
        .text(d.data.name).style('pointer-events', 'none');
    });
  }, [data, width, height, colors, onSelect]);

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label="Organization Chart visualization"
      style={{ width: '100%', height: 'auto', overflow: 'visible' }} />
  );
}

/** The page's own sample data, the default when no data is passed. */
export const sampleData = {
  "name": "Chief Technology Officer",
  "children": [
    {
      "name": "VP Engineering",
      "children": [
        {
          "name": "Platform team",
          "value": 1
        },
        {
          "name": "Product engineering",
          "value": 1
        },
        {
          "name": "Quality engineering",
          "value": 1
        }
      ]
    },
    {
      "name": "VP Security",
      "children": [
        {
          "name": "Security operations",
          "value": 1
        },
        {
          "name": "GRC",
          "value": 1
        }
      ]
    },
    {
      "name": "VP Data",
      "children": [
        {
          "name": "Data engineering",
          "value": 1
        },
        {
          "name": "Analytics",
          "value": 1
        },
        {
          "name": "Machine learning",
          "value": 1
        }
      ]
    }
  ]
};

export default function OrganizationChartWithData(props) {
  return <OrganizationChart data={sampleData} {...props} />;
}
