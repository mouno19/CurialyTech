import { useState } from "react";
// Page curtain (React) · motion-scroll-page-curtain-react: from the scroll motion mock (Curialy component library). Sample copy and photos are placeholders.
// Needs the stylesheet styles/motion-scroll-lab.css; the wrapper below gives it its scope. Under prefers-reduced-motion the stylesheet
// shows reveals and stops CSS transitions.
function ArrowIcon({ down = false }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={down ? "icon-down" : ""}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>;
}

function PageCurtainDemo() {
  const [phase, setPhase] = useState("idle");
  const [alternate, setAlternate] = useState(false);
  const play = () => {
    if (phase !== "idle") return;
    setPhase("cover");
    window.setTimeout(() => {
      setAlternate((value) => !value);
      setPhase("reveal");
    }, 650);
    window.setTimeout(() => setPhase("idle"), 1450);
  };
  return <section id="component-7" className="demo-section">
      
      <div className={`curtain-preview ${alternate ? "alternate" : ""}`}>
        <div className="curtain-content">
          <span>PAGE / {alternate ? "B" : "A"}</span>
          <h3>{alternate ? "A new perspective." : "Ready for what\u2019s next?"}</h3>
          <button type="button" onClick={play} disabled={phase !== "idle"}>
            <span>PLAY TRANSITION</span>
            <ArrowIcon />
          </button>
        </div>
        <div className={`curtain curtain-${phase}`}>
          <span>MOTION / LAB</span>
        </div>
      </div>
    </section>;
}

export default function PageCurtain() {
  return (
    <div className="cx-motion-scroll-lab">
      <PageCurtainDemo />
    </div>
  );
}
