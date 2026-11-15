import { useEffect, useRef, useState } from "react";
// Staggered grid (React) · motion-scroll-staggered-grid-react: from the scroll motion mock (Curialy component library). Sample copy and photos are placeholders.
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

function StaggeredGridDemo() {
  const cards = [
    ["01", "Discover", "Observe the rhythm"],
    ["02", "Compose", "Shape the narrative"],
    ["03", "Refine", "Remove the excess"],
    ["04", "Release", "Let it move"]
  ];
  const { ref, visible } = useInView(0.18);
  return <section id="component-2" className="demo-section">
      
      <div ref={ref} className={`stagger-grid ${visible ? "is-visible" : ""}`}>
        {cards.map(([number, title, copy], index) => <article
    key={title}
    className="stagger-card"
    style={{ "--item-delay": `${index * 110}ms` }}
  >
            <span>{number}</span>
            <div className="card-orbit" />
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>)}
      </div>
    </section>;
}

export default function StaggeredGrid() {
  return (
    <div className="cx-motion-scroll-lab">
      <StaggeredGridDemo />
    </div>
  );
}
