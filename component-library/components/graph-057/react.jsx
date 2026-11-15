// Density Map · graph-057
// From the Geospatial Visualization (Curialy component library). Sample data is fictional; pass your own.
// Install: npm install leaflet
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function GRAPH057({ data = [{"name":"Midtown Manhattan","lat":40.7549,"lng":-73.984,"value":96},{"name":"Lower Manhattan","lat":40.7074,"lng":-74.0113,"value":78},{"name":"Downtown Brooklyn","lat":40.6928,"lng":-73.9903,"value":72},{"name":"Long Island City","lat":40.7447,"lng":-73.9485,"value":66},{"name":"Williamsburg","lat":40.7081,"lng":-73.9571,"value":61},{"name":"Astoria","lat":40.7644,"lng":-73.9235,"value":47},{"name":"Jersey City","lat":40.7178,"lng":-74.0431,"value":53}] }) {
  const host = useRef(null);
  useEffect(() => {
    const map = L.map(host.current, { center: [40.735,-73.96], zoom: 10, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);
    data.forEach(d => {
      L.circleMarker([d.lat, d.lng], { radius: 30 + d.value * .28,
        stroke: false, fillColor: d.value > 75 ? '#ff859e' : '#6d91ff', fillOpacity: .09 }).addTo(map);
      L.circleMarker([d.lat, d.lng], { radius: 4, color: '#ffffff',
        fillColor: '#6ce7e7', fillOpacity: 1 }).addTo(map).bindTooltip(d.name + ' · ' + d.value);
    });
    return () => map.remove();
  }, [data]);
  return <div ref={host} role="img" aria-label="Density Map" style={{ height: 320, width: '100%' }} />;
}

export default GRAPH057;
