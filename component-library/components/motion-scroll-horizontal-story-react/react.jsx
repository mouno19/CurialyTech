import { useEffect, useRef, useState } from "react";
// Horizontal story (React) · motion-scroll-horizontal-story-react: from the scroll motion mock (Curialy component library). Sample copy and photos are placeholders.
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

function HorizontalStoryDemo() {
  const { ref, progress } = useElementProgress();
  const chapters = [
    ["01", "Signal", "Every journey starts with a faint signal.", IMAGES.concrete],
    ["02", "Form", "An idea gains edges, weight, and direction.", IMAGES.wall],
    ["03", "Motion", "The system comes alive through response.", IMAGES.shadows]
  ];
  return <section id="component-4" className="demo-section horizontal-wrap">
      
      <div ref={ref} className="horizontal-track-space">
        <div className="horizontal-sticky">
          <div
    className="horizontal-track"
    style={{ transform: `translate3d(${-progress * 66.6667}%, 0, 0)` }}
  >
            {chapters.map(([number, title, copy, image]) => <article className="story-panel" key={title}>
                <div className="story-image">
                  <img src={image} alt="" />
                </div>
                <div className="story-copy">
                  <span>CHAPTER {number}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>)}
          </div>
          <div className="horizontal-progress">
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      </div>
    </section>;
}

export default function HorizontalStory() {
  return (
    <div className="cx-motion-scroll-lab">
      <HorizontalStoryDemo />
    </div>
  );
}
