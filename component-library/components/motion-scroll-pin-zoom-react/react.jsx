import { useEffect, useRef, useState } from "react";
// Image pin and zoom (React) · motion-scroll-pin-zoom-react: from the scroll motion mock (Curialy component library). Sample copy and photos are placeholders.
// Needs the stylesheet styles/motion-scroll-lab.css; the wrapper below gives it its scope. Under prefers-reduced-motion the stylesheet
// shows reveals and stops CSS transitions; the transforms this sets from scroll progress still move, so check matchMedia("(prefers-reduced-motion: reduce)") before applying them.
const IMAGES = {
  concrete: "https://images.unsplash.com/photo-1521194263619-39ecc5b55c61?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600",
  wall: "https://images.unsplash.com/photo-1664636334074-0d09ea0d0ba8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600",
  shadows: "https://images.unsplash.com/photo-1759300631960-be501eb8ceea?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600",
  mountain: "https://images.unsplash.com/photo-1600700486032-dd295c7cfe7f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1800",
  road: "https://images.unsplash.com/photo-1600700486076-7c75ae467765?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"
};
function useElementProgress() {
  const ref = useRef(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const distance = rect.height - window.innerHeight;
      const value = distance <= 0 ? 0 : -rect.top / distance;
      setProgress(Math.max(0, Math.min(1, value)));
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return { ref, progress };
}

function PinZoomDemo() {
  const { ref, progress } = useElementProgress();
  const scale = 0.72 + progress * 0.28;
  const radius = 28 * (1 - progress);
  return <section id="component-10" className="demo-section pin-section">
      
      <div ref={ref} className="pin-space">
        <div className="pin-sticky">
          <div
    className="pin-image"
    style={{
      transform: `scale(${scale})`,
      borderRadius: `${radius}px`
    }}
  >
            <img src={IMAGES.concrete} alt="Concrete wall with geometric light and shadow" />
            <div className="pin-caption">
              <span>STUDY / LIGHT 01</span>
              <h3>Form, revealed.</h3>
            </div>
          </div>
        </div>
      </div>
    </section>;
}

export default function ImagePinAndZoom() {
  return (
    <div className="cx-motion-scroll-lab">
      <PinZoomDemo />
    </div>
  );
}
