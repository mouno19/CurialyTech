// Hexagonal Geographic Map · graph-055
// From the Geospatial Visualization (Curialy component library). Sample data is fictional; pass your own.
// Install: npm install leaflet
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function GRAPH055({ data = [{"name":"Pacific Northwest","lat":47,"lng":-122,"value":38},{"name":"California","lat":37,"lng":-119,"value":82},{"name":"Mountain West","lat":40,"lng":-111,"value":34},{"name":"Texas","lat":31,"lng":-99,"value":70},{"name":"Midwest","lat":42,"lng":-89,"value":53},{"name":"Northeast","lat":42,"lng":-73,"value":88},{"name":"Southeast","lat":34,"lng":-84,"value":61},{"name":"Great Plains","lat":43,"lng":-101,"value":29}] }) {
  const host = useRef(null);
  useEffect(() => {
    const map = L.map(host.current, { center: [39,-98], zoom: 4, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);
    data.forEach(d => {
      const hex = Array.from({ length: 6 }, (_, i) => {
        const angle = Math.PI / 3 * i + Math.PI / 6;
        return [d.lat + 3.1 * Math.cos(angle), d.lng + 4.1 * Math.sin(angle)];
      });
      L.polygon(hex, { color: '#b0f5ee', weight: 1,
        fillColor: d.value > 70 ? '#ffbd76' : '#6ce7e7', fillOpacity: .52
      }).addTo(map).bindTooltip(d.name + ' · ' + d.value);
    });
    return () => map.remove();
  }, [data]);
  return <div ref={host} role="img" aria-label="Hexagonal Geographic Map" style={{ height: 320, width: '100%' }} />;
}

export default GRAPH055;
