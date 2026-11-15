// 3D Globe Visualization · graph-056
// From the Geospatial Visualization (Curialy component library). Sample data is fictional; pass your own.
// Install: npm install three
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function GRAPH056( { data = [{"layer":"Earth surface","source":"Earth texture"},{"layer":"Atmosphere","opacity":0.14},{"layer":"Rotation","degreesPerFrame":0.0015}] } ) {
  const host = useRef(null);
  useEffect(() => {
    const el = host.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, el.clientWidth / 280, .1, 100);
    camera.position.z = 5.5;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(el.clientWidth, 280);
    el.appendChild(renderer.domElement);
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1.62, 64, 64),
      new THREE.MeshPhongMaterial({ color: 0x5e9bbc })
    );
    scene.add(earth, new THREE.AmbientLight(0xffffff, 1.5));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(4, 3, 5); scene.add(light);
    new THREE.TextureLoader().load(
      'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',
      texture => { earth.material.map = texture; earth.material.needsUpdate = true; }
    );
    let frame;
    function render() { frame = requestAnimationFrame(render); earth.rotation.y += .0015; renderer.render(scene, camera); }
    render();
    return () => { cancelAnimationFrame(frame); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, []);
  return <div ref={host} role="img" aria-label="Rotating 3D Earth" style={{height:280}} />;
}

export default GRAPH056;
