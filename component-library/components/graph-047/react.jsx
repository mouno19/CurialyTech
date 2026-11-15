// Chord Diagram · graph-047
// From the Network Atlas (Curialy component library). Sample data is fictional; pass your own.
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export function ChordDiagram({
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
    const chords = d3.chord().padAngle(.05)(data.matrix);
    const radius = Math.min(width, height) / 2 - 35;
    const layer = root.attr('transform',
      `translate(${width/2},${height/2})`);
    const arc = d3.arc().innerRadius(radius - 15).outerRadius(radius);
    const ribbon = d3.ribbon().radius(radius - 19);
    layer.selectAll('path.ribbon').data(chords).join('path')
      .attr('class', 'ribbon').attr('d', ribbon)
      .attr('fill', d => colors[d.source.index % colors.length])
      .attr('fill-opacity', .4)
      .each(function(d) { choose(d3.select(this), d); });
    layer.selectAll('path.group').data(chords.groups)
      .join('path').attr('class', 'group').attr('d', arc)
      .attr('fill', d => colors[d.index % colors.length])
      .each(function(d) {
        choose(d3.select(this), {
          name: data.groups[d.index], value: d.value
        });
      });
  }, [data, width, height, colors, onSelect]);

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label="Chord Diagram visualization"
      style={{ width: '100%', height: 'auto', overflow: 'visible' }} />
  );
}

/** The page's own sample data, the default when no data is passed. */
export const sampleData = {
  "groups": [
    "Engineering",
    "Design",
    "Product",
    "Security",
    "Data"
  ],
  "matrix": [
    [
      0,
      18,
      24,
      8,
      12
    ],
    [
      18,
      0,
      22,
      4,
      7
    ],
    [
      24,
      22,
      0,
      9,
      15
    ],
    [
      8,
      4,
      9,
      0,
      11
    ],
    [
      12,
      7,
      15,
      11,
      0
    ]
  ]
};

export default function ChordDiagramWithData(props) {
  return <ChordDiagram data={sampleData} {...props} />;
}
