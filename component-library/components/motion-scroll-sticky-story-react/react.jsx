import { useEffect, useRef, useState } from "react";
// Sticky storytelling (React) · motion-scroll-sticky-story-react: from the scroll motion mock (Curialy component library). Sample copy and photos are placeholders.
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

function StickyStoryDemo() {
  const { ref, progress } = useElementProgress();
  const index = Math.min(2, Math.floor(progress * 3));
  const scenes = [
    { word: "LISTEN", copy: "Begin with what is already there." },
    { word: "DISTILL", copy: "Find the single idea worth keeping." },
    { word: "BUILD", copy: "Give the idea a living, moving form." }
  ];
  return <section id="component-5" className="demo-section">
      
      <div ref={ref} className="sticky-story-space">
        <div className="sticky-scene">
          <div className="scene-count">0{index + 1} / 03</div>
          <div className="scene-art" aria-hidden="true">
            <span className={`shape shape-${index}`} />
            <span className="scene-grid" />
          </div>
          <div key={index} className="scene-text">
            <span>THE PROCESS</span>
            <h3>{scenes[index].word}</h3>
            <p>{scenes[index].copy}</p>
          </div>
          <div className="scene-dots">
            {scenes.map((scene, dotIndex) => <span key={scene.word} className={dotIndex === index ? "active" : ""} />)}
          </div>
        </div>
      </div>
    </section>;
}

export default function StickyStorytelling() {
  return (
    <div className="cx-motion-scroll-lab">
      <StickyStoryDemo />
    </div>
  );
}
