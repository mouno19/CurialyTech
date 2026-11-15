import { useEffect, useRef, useState } from "react";
// Scroll reveal (React) · motion-scroll-reveal-react: from the scroll motion mock (Curialy component library). Sample copy and photos are placeholders.
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

function ScrollRevealDemo() {
  return <section id="component-1" className="demo-section">
      
      <div className="reveal-stage">
        <Reveal direction="left" duration={950}>
          <span className="stage-kicker">A quiet entrance</span>
          <h3>Movement should guide attention, not demand it.</h3>
        </Reveal>
        <Reveal direction="right" duration={950} delay={140}>
          <p>
            Scroll back and forth. The observer resets as the element leaves the viewport, making
            this preview easy to test repeatedly.
          </p>
          <div className="fine-line" />
        </Reveal>
      </div>
    </section>;
}

export default function ScrollReveal() {
  return (
    <div className="cx-motion-scroll-lab">
      <ScrollRevealDemo />
    </div>
  );
}
