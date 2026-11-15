// Animated-Style Migration Flow Map · graph-060
// From the Geospatial Visualization (Curialy component library). Sample data is fictional; pass your own.
// Install: npm install leaflet
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function GRAPH060({ data = [{"from":"São Paulo","to":"New York","value":34},{"from":"Lagos","to":"London","value":51},{"from":"Mumbai","to":"Dubai","value":69},{"from":"Singapore","to":"Sydney","value":39},{"from":"Paris","to":"Tokyo","value":25}] }) {
  const host = useRef(null);
  useEffect(() => {
    const map = L.map(host.current, { center: [18,23], zoom: 2, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);
    const cities = [{"name":"New York","lat":40.7128,"lng":-74.006,"value":72},{"name":"London","lat":51.5072,"lng":-0.1276,"value":88},{"name":"Paris","lat":48.8566,"lng":2.3522,"value":63},{"name":"Dubai","lat":25.2048,"lng":55.2708,"value":57},{"name":"Singapore","lat":1.3521,"lng":103.8198,"value":76},{"name":"Tokyo","lat":35.6762,"lng":139.6503,"value":91},{"name":"Sydney","lat":-33.8688,"lng":151.2093,"value":53},{"name":"São Paulo","lat":-23.5505,"lng":-46.6333,"value":48},{"name":"Lagos","lat":6.5244,"lng":3.3792,"value":41},{"name":"Mumbai","lat":19.076,"lng":72.8777,"value":69}];
    const lookup = Object.fromEntries(cities.map(city => [city.name, city]));
    data.forEach(route => {
      const a = lookup[route.from], b = lookup[route.to];
      if (!a || !b) return;
      let end = b.lng;
      if (end - a.lng > 180) end -= 360;
      if (end - a.lng < -180) end += 360;
      const arc = Array.from({ length: 35 }, (_, i) => {
        const t = i / 34;
        return [a.lat + (b.lat-a.lat)*t + Math.sin(Math.PI*t)*9, a.lng + (end-a.lng)*t];
      });
      L.polyline(arc, { color: '#6ce7e7',
        weight: 1.6 + route.value/50, opacity: .85, dashArray: '7 10'
      }).addTo(map).bindTooltip(route.from + ' → ' + route.to + ' · ' + route.value);
    });
    return () => map.remove();
  }, [data]);
  return <div ref={host} role="img" aria-label="Animated-Style Migration Flow Map" style={{ height: 320, width: '100%' }} />;
}

export default GRAPH060;
