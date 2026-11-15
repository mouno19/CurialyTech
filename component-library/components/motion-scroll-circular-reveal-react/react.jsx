import { useState } from "react";
// Circular reveal (React) · motion-scroll-circular-reveal-react: from the scroll motion mock (Curialy component library). Sample copy and photos are placeholders.
// Needs the stylesheet styles/motion-scroll-lab.css; the wrapper below gives it its scope. Under prefers-reduced-motion the stylesheet
// shows reveals and stops CSS transitions.
const IMAGES = {
  concrete: "https://images.unsplash.com/photo-1521194263619-39ecc5b55c61?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600",
  wall: "https://images.unsplash.com/photo-1664636334074-0d09ea0d0ba8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600",
  shadows: "https://images.unsplash.com/photo-1759300631960-be501eb8ceea?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600",
  mountain: "https://images.unsplash.com/photo-1600700486032-dd295c7cfe7f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1800",
  road: "https://images.unsplash.com/photo-1600700486076-7c75ae467765?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"
};
function ArrowIcon({ down = false }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={down ? "icon-down" : ""}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>;
}
function ReplayIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4v6h6M5.6 15a7 7 0 1 0 .2-6.2L4 10" />
    </svg>;
}

function CircularRevealDemo() {
  const [open, setOpen] = useState(false);
  return <section id="component-8" className="demo-section">
      
      <div className="circle-preview">
        <div className="circle-base">
          <span>BEFORE</span>
          <h3>Structure</h3>
        </div>
        <div className={`circle-layer ${open ? "is-open" : ""}`}>
          <img src={IMAGES.road} alt="Road disappearing into an open landscape" />
          <span>AFTER</span>
          <h3>Possibility</h3>
        </div>
        <button
    type="button"
    className="circle-trigger"
    onClick={() => setOpen((value) => !value)}
    aria-label={open ? "Close circular reveal" : "Open circular reveal"}
  >
          {open ? <ReplayIcon /> : <ArrowIcon />}
        </button>
      </div>
    </section>;
}

export default function CircularReveal() {
  return (
    <div className="cx-motion-scroll-lab">
      <CircularRevealDemo />
    </div>
  );
}
