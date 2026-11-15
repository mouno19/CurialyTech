// Regional Heat Map · graph-052
// From the Geospatial Visualization (Curialy component library). Sample data is fictional; pass your own.
// Install: npm install leaflet
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function GRAPH052({ data = [{"name":"London","lat":51.5072,"lng":-0.1276,"value":86},{"name":"Paris","lat":48.8566,"lng":2.3522,"value":76},{"name":"Berlin","lat":52.52,"lng":13.405,"value":65},{"name":"Madrid","lat":40.4168,"lng":-3.7038,"value":55},{"name":"Rome","lat":41.9028,"lng":12.4964,"value":61},{"name":"Amsterdam","lat":52.3676,"lng":4.9041,"value":71},{"name":"Milan","lat":45.4642,"lng":9.19,"value":67},{"name":"Warsaw","lat":52.2297,"lng":21.0122,"value":48}] }) {
  const host = useRef(null);
  useEffect(() => {
    const map = L.map(host.current, { center: [49,11], zoom: 4, scrollWheelZoom: false });
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
  return <div ref={host} role="img" aria-label="Regional Heat Map" style={{ height: 320, width: '100%' }} />;
}

export default GRAPH052;
