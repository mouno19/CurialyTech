// Geographic Network Map · graph-058
// From the Geospatial Visualization (Curialy component library). Sample data is fictional; pass your own.
// Install: npm install leaflet
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function GRAPH058({ data = [{"hub":"London","links":["New York","Paris","Dubai","Lagos"]},{"hub":"Singapore","links":["Dubai","Tokyo","Sydney","Mumbai"]},{"hub":"New York","links":["São Paulo","Tokyo"]}] }) {
  const host = useRef(null);
  useEffect(() => {
    const map = L.map(host.current, { center: [17,18], zoom: 2, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);
    const cities = [{"name":"New York","lat":40.7128,"lng":-74.006,"value":72},{"name":"London","lat":51.5072,"lng":-0.1276,"value":88},{"name":"Paris","lat":48.8566,"lng":2.3522,"value":63},{"name":"Dubai","lat":25.2048,"lng":55.2708,"value":57},{"name":"Singapore","lat":1.3521,"lng":103.8198,"value":76},{"name":"Tokyo","lat":35.6762,"lng":139.6503,"value":91},{"name":"Sydney","lat":-33.8688,"lng":151.2093,"value":53},{"name":"São Paulo","lat":-23.5505,"lng":-46.6333,"value":48},{"name":"Lagos","lat":6.5244,"lng":3.3792,"value":41},{"name":"Mumbai","lat":19.076,"lng":72.8777,"value":69}];
    const lookup = Object.fromEntries(cities.map(city => [city.name, city]));
    data.forEach(group => group.links.forEach((name, index) => {
      const a = lookup[group.hub], b = lookup[name];
      if (a && b) L.polyline([[a.lat,a.lng],[b.lat,b.lng]], {
        color: index === 0 ? '#ffbd76' : '#6d91ff', weight: index === 0 ? 2.5 : 1.5
      }).addTo(map);
    }));
    cities.forEach(d => L.circleMarker([d.lat,d.lng], { radius: 4, color: '#6ce7e7' }).addTo(map).bindTooltip(d.name));
    return () => map.remove();
  }, [data]);
  return <div ref={host} role="img" aria-label="Geographic Network Map" style={{ height: 320, width: '100%' }} />;
}

export default GRAPH058;
