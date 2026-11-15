import { useEffect, useRef, useState } from "react";
// Scroll progress (React) · motion-scroll-progress-react: from the scroll motion mock (Curialy component library). Sample copy and photos are placeholders.
// Needs the stylesheet styles/motion-scroll-lab.css; the wrapper below gives it its scope. Under prefers-reduced-motion the stylesheet
// shows reveals and stops CSS transitions; the transforms this sets from scroll progress still move, so check matchMedia("(prefers-reduced-motion: reduce)") before applying them.
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

function ProgressDemo() {
  const { ref, progress } = useElementProgress();
  return <section id="component-9" className="demo-section">
      
      <div ref={ref} className="progress-article">
        <aside>
          <div className="progress-ring">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" />
              <circle
    className="progress-value"
    cx="50"
    cy="50"
    r="44"
    style={{ strokeDashoffset: 276.5 * (1 - progress) }}
  />
            </svg>
            <strong>{Math.round(progress * 100)}%</strong>
          </div>
          <span>READING PROGRESS</span>
        </aside>
        <article>
          <span>FIELD NOTES / 005</span>
          <h3>The pace of attention</h3>
          <p>
            We don’t experience digital spaces all at once. We move through them—one gesture, one
            pause, one moment of attention at a time.
          </p>
          <p>
            Good motion respects that pace. It arrives when context is needed, recedes when the
            message is clear, and leaves the interface calmer than it found it.
          </p>
          <blockquote>“Timing is not a detail. Timing is the design.”</blockquote>
          <p>
            This component measures the article itself, not the entire page, so it stays reusable in
            complex layouts and embedded reading views.
          </p>
        </article>
      </div>
    </section>;
}

export default function ScrollProgress() {
  return (
    <div className="cx-motion-scroll-lab">
      <ProgressDemo />
    </div>
  );
}
