// Circle Packing · graph-043
// From the Network Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export function CirclePacking({
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
    d3.pack().size([width - 40, height - 40]).padding(8)(hierarchy);
    root.attr('transform', 'translate(20,20)')
      .selectAll('circle').data(hierarchy.descendants().slice(1))
      .join('circle').attr('cx', d => d.x).attr('cy', d => d.y)
      .attr('r', d => d.r)
      .attr('fill', d => colors[(d.depth === 1
        ? hierarchy.children.indexOf(d)
        : hierarchy.children.indexOf(d.parent)) % colors.length])
      .attr('fill-opacity', d => d.children ? .15 : .7)
      .attr('stroke', '#d8f7ff')
      .each(function(d) { choose(d3.select(this), d.data); });
  }, [data, width, height, colors, onSelect]);

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label="Circle Packing visualization"
      style={{ width: '100%', height: 'auto', overflow: 'visible' }} />
  );
}

/** The page's own sample data, the default when no data is passed. */
export const sampleData = {
  "name": "Research portfolio",
  "children": [
    {
      "name": "Climate",
      "children": [
        {
          "name": "Ocean models",
          "value": 31
        },
        {
          "name": "Atmospheric",
          "value": 24
        },
        {
          "name": "Carbon cycle",
          "value": 18
        }
      ]
    },
    {
      "name": "Biology",
      "children": [
        {
          "name": "Genomics",
          "value": 26
        },
        {
          "name": "Cell imaging",
          "value": 20
        },
        {
          "name": "Proteomics",
          "value": 15
        }
      ]
    },
    {
      "name": "Materials",
      "children": [
        {
          "name": "Batteries",
          "value": 22
        },
        {
          "name": "Polymers",
          "value": 17
        },
        {
          "name": "Quantum",
          "value": 12
        }
      ]
    }
  ]
};

export default function CirclePackingWithData(props) {
  return <CirclePacking data={sampleData} {...props} />;
}
