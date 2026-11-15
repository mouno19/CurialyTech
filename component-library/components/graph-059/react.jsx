// Territory Comparison Map · graph-059
// From the Geospatial Visualization (Curialy component library). Sample data is fictional; pass your own.
// Install: npm install leaflet
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function GRAPH059({ data = [{"country":"France","iso":"FRA","value":74},{"country":"Germany","iso":"DEU","value":81},{"country":"Spain","iso":"ESP","value":62}] }) {
  const host = useRef(null);
  useEffect(() => {
    const map = L.map(host.current, { center: [49,11], zoom: 4, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);
    fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson')
      .then(response => response.json())
      .then(geojson => {
        const scores = Object.fromEntries(data.map(d => [d.country, d.index ?? d.value]));
        L.geoJSON(geojson, {
          style: feature => {
            const name = feature.properties.name;
            const value = scores[name] ?? (name === 'United States of America' ? scores['United States'] : undefined);
            return { color: value == null ? '#64839a' : '#a6edee', weight: value == null ? .35 : 1,
              fillColor: value == null ? '#34506b' : value >= 80 ? '#ffbd76' : value >= 65 ? '#6ce7e7' : '#6d91ff',
              fillOpacity: value == null ? .06 : .55 };
          },
          onEachFeature: (feature, layer) => {
            const name = feature.properties.name;
            const value = scores[name] ?? (name === 'United States of America' ? scores['United States'] : undefined);
            if (value != null) layer.bindTooltip(name + ' · ' + value);
          }
        }).addTo(map);
      });
    return () => map.remove();
  }, [data]);
  return <div ref={host} role="img" aria-label="Territory Comparison Map" style={{ height: 320, width: '100%' }} />;
}

export default GRAPH059;
