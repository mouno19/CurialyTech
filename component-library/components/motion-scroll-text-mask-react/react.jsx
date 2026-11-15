import { useEffect, useRef, useState } from "react";
// Text mask reveal (React) · motion-scroll-text-mask-react: from the scroll motion mock (Curialy component library). Sample copy and photos are placeholders.
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

function TextMaskDemo() {
  const { ref, visible } = useInView(0.35);
  return <section id="component-6" className="demo-section">
      
      <div ref={ref} className={`mask-stage ${visible ? "is-visible" : ""}`}>
        {["MAKE THE", "INVISIBLE", "FELT."].map((line, index) => <div className="mask-line" key={line}>
            <span style={{ "--line": index }}>{line}</span>
          </div>)}
        <p>— Motion as a language, not decoration.</p>
      </div>
    </section>;
}

export default function TextMaskReveal() {
  return (
    <div className="cx-motion-scroll-lab">
      <TextMaskDemo />
    </div>
  );
}
