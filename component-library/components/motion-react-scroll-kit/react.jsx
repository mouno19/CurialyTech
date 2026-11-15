import { useEffect, useRef, useState } from "react";
// Scroll motion kit (React) · motion-react-scroll-kit: from the scroll motion mock (Curialy component library). Sample copy and photos are placeholders.
// Needs the stylesheet styles/motion-scroll-lab.css; the wrapper below gives it its scope. Under prefers-reduced-motion the stylesheet
// shows reveals and stops CSS transitions.
function useInView(threshold = 0.2) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, visible };
}
function Reveal({
  children,
  direction = "up",
  duration = 800,
  delay = 0,
  threshold = 0.2,
  className = ""
}) {
  const { ref, visible } = useInView(threshold);
  return <div
    ref={ref}
    className={`reveal reveal-${direction} ${visible ? "is-visible" : ""} ${className}`}
    style={{
      "--reveal-duration": `${duration}ms`,
      "--reveal-delay": `${delay}ms`
    }}
  >
      {children}
    </div>;
}
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

function ScrollKitDemo() {
  return (
    <section className="demo-section">
      {["up", "left", "right"].map((direction, index) => (
        <Reveal key={direction} direction={direction} delay={index * 120}>
          <h3>Reveal {direction}</h3>
          <p>Enters when 20% of it is in view, on the shared ease.</p>
        </Reveal>
      ))}
    </section>
  );
}

export default function ScrollMotionKit() {
  return (
    <div className="cx-motion-scroll-lab">
      <ScrollKitDemo />
    </div>
  );
}

export { useInView, useElementProgress, Reveal };
