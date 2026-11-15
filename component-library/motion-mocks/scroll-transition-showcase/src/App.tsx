import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";

const IMAGES = {
  concrete:
    "https://images.unsplash.com/photo-1521194263619-39ecc5b55c61?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600",
  wall: "https://images.unsplash.com/photo-1664636334074-0d09ea0d0ba8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600",
  shadows:
    "https://images.unsplash.com/photo-1759300631960-be501eb8ceea?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600",
  mountain:
    "https://images.unsplash.com/photo-1600700486032-dd295c7cfe7f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1800",
  road: "https://images.unsplash.com/photo-1600700486076-7c75ae467765?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600",
};

type RevealProps = {
  children: ReactNode;
  direction?: "up" | "down" | "left" | "right";
  duration?: number;
  delay?: number;
  threshold?: number;
  className?: string;
};

function useInView<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold,
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
  className = "",
}: RevealProps) {
  const { ref, visible } = useInView<HTMLDivElement>(threshold);
  return (
    <div
      ref={ref}
      className={`reveal reveal-${direction} ${visible ? "is-visible" : ""} ${className}`}
      style={
        {
          "--reveal-duration": `${duration}ms`,
          "--reveal-delay": `${delay}ms`,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

function useElementProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
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

function ArrowIcon({ down = false }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={down ? "icon-down" : ""}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4v6h6M5.6 15a7 7 0 1 0 .2-6.2L4 10" />
    </svg>
  );
}

const components = [
  "Scroll Reveal",
  "Staggered Grid",
  "Parallax",
  "Horizontal Story",
  "Sticky Panels",
  "Text Mask",
  "Page Curtain",
  "Circular Reveal",
  "Scroll Progress",
  "Pin & Zoom",
];

function DemoHeader({
  number,
  title,
  description,
  meta,
}: {
  number: string;
  title: string;
  description: string;
  meta: string;
}) {
  return (
    <Reveal className="demo-heading">
      <div className="eyebrow">COMPONENT {number}</div>
      <h2>{title}</h2>
      <div className="demo-intro">
        <p>{description}</p>
        <span>{meta}</span>
      </div>
    </Reveal>
  );
}

function ScrollRevealDemo() {
  return (
    <section id="component-1" className="demo-section">
      <DemoHeader
        number="01"
        title="Scroll Reveal"
        description="Content enters with intent—soft opacity, directional movement, and a clean finish."
        meta="DIRECTION: UP · 800MS · 20% TRIGGER"
      />
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
    </section>
  );
}

function StaggeredGridDemo() {
  const cards = [
    ["01", "Discover", "Observe the rhythm"],
    ["02", "Compose", "Shape the narrative"],
    ["03", "Refine", "Remove the excess"],
    ["04", "Release", "Let it move"],
  ];
  const { ref, visible } = useInView<HTMLDivElement>(0.18);

  return (
    <section id="component-2" className="demo-section">
      <DemoHeader
        number="02"
        title="Staggered Grid"
        description="A configurable sequence turns a collection into a deliberate visual rhythm."
        meta="STAGGER: 110MS · EASE: CUBIC-BEZIER"
      />
      <div ref={ref} className={`stagger-grid ${visible ? "is-visible" : ""}`}>
        {cards.map(([number, title, copy], index) => (
          <article
            key={title}
            className="stagger-card"
            style={{ "--item-delay": `${index * 110}ms` } as CSSProperties}
          >
            <span>{number}</span>
            <div className="card-orbit" />
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ParallaxDemo() {
  const { ref, progress } = useElementProgress<HTMLDivElement>();
  const shift = (progress - 0.5) * 140;
  return (
    <section id="component-3" className="demo-section full-bleed">
      <DemoHeader
        number="03"
        title="Parallax Depth"
        description="Independent layers travel at different speeds to create spatial depth without hijacking scroll."
        meta="BACKGROUND: .25× · FOREGROUND: .65×"
      />
      <div ref={ref} className="parallax-window">
        <img
          className="parallax-bg"
          src={IMAGES.mountain}
          alt="Mountain ridge under a dramatic grey sky"
          style={{ transform: `translate3d(0, ${shift * 0.35}px, 0) scale(1.15)` }}
        />
        <div
          className="parallax-sun"
          style={{ transform: `translate3d(0, ${shift * -0.4}px, 0)` }}
        />
        <div
          className="parallax-copy"
          style={{ transform: `translate3d(0, ${shift * -0.7}px, 0)` }}
        >
          <span>ALTITUDE / 2,410 M</span>
          <h3>Somewhere above the noise.</h3>
        </div>
        <span className="photo-credit">PHOTO / TOLGA AHMETLER</span>
      </div>
    </section>
  );
}

function HorizontalStoryDemo() {
  const { ref, progress } = useElementProgress<HTMLDivElement>();
  const chapters = [
    ["01", "Signal", "Every journey starts with a faint signal.", IMAGES.concrete],
    ["02", "Form", "An idea gains edges, weight, and direction.", IMAGES.wall],
    ["03", "Motion", "The system comes alive through response.", IMAGES.shadows],
  ];

  return (
    <section id="component-4" className="demo-section horizontal-wrap">
      <DemoHeader
        number="04"
        title="Horizontal Story"
        description="Vertical input powers a cinematic, horizontal chapter sequence."
        meta="PINNED · TOUCH SAFE · NATIVE SCROLL"
      />
      <div ref={ref} className="horizontal-track-space">
        <div className="horizontal-sticky">
          <div
            className="horizontal-track"
            style={{ transform: `translate3d(${-progress * 66.6667}%, 0, 0)` }}
          >
            {chapters.map(([number, title, copy, image]) => (
              <article className="story-panel" key={title}>
                <div className="story-image">
                  <img src={image} alt="" />
                </div>
                <div className="story-copy">
                  <span>CHAPTER {number}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="horizontal-progress">
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}

function StickyStoryDemo() {
  const { ref, progress } = useElementProgress<HTMLDivElement>();
  const index = Math.min(2, Math.floor(progress * 3));
  const scenes = [
    { word: "LISTEN", copy: "Begin with what is already there." },
    { word: "DISTILL", copy: "Find the single idea worth keeping." },
    { word: "BUILD", copy: "Give the idea a living, moving form." },
  ];
  return (
    <section id="component-5" className="demo-section">
      <DemoHeader
        number="05"
        title="Sticky Story Panels"
        description="One fixed canvas evolves as the reader moves through an unfolding narrative."
        meta="3 SCENES · CROSSFADE · STICKY"
      />
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
            {scenes.map((scene, dotIndex) => (
              <span key={scene.word} className={dotIndex === index ? "active" : ""} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TextMaskDemo() {
  const { ref, visible } = useInView<HTMLDivElement>(0.35);
  return (
    <section id="component-6" className="demo-section">
      <DemoHeader
        number="06"
        title="Text Mask Reveal"
        description="Typography is uncovered line by line through precise animated clipping."
        meta="LINE STAGGER · CLIP-PATH · 900MS"
      />
      <div ref={ref} className={`mask-stage ${visible ? "is-visible" : ""}`}>
        {["MAKE THE", "INVISIBLE", "FELT."].map((line, index) => (
          <div className="mask-line" key={line}>
            <span style={{ "--line": index } as CSSProperties}>{line}</span>
          </div>
        ))}
        <p>— Motion as a language, not decoration.</p>
      </div>
    </section>
  );
}

function PageCurtainDemo() {
  const [phase, setPhase] = useState<"idle" | "cover" | "reveal">("idle");
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

  return (
    <section id="component-7" className="demo-section">
      <DemoHeader
        number="07"
        title="Page Curtain"
        description="A polished full-page transition that covers, swaps, and reveals without changing browser behavior."
        meta="1200MS · QUART EASE · CLICK TO PLAY"
      />
      <div className={`curtain-preview ${alternate ? "alternate" : ""}`}>
        <div className="curtain-content">
          <span>PAGE / {alternate ? "B" : "A"}</span>
          <h3>{alternate ? "A new perspective." : "Ready for what’s next?"}</h3>
          <button type="button" onClick={play} disabled={phase !== "idle"}>
            <span>PLAY TRANSITION</span>
            <ArrowIcon />
          </button>
        </div>
        <div className={`curtain curtain-${phase}`}>
          <span>MOTION / LAB</span>
        </div>
      </div>
    </section>
  );
}

function CircularRevealDemo() {
  const [open, setOpen] = useState(false);
  return (
    <section id="component-8" className="demo-section">
      <DemoHeader
        number="08"
        title="Circular Reveal"
        description="A new scene expands outward from a precise point of interaction."
        meta="CLIP-PATH · 1000MS · REVERSIBLE"
      />
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
    </section>
  );
}

function ProgressDemo() {
  const { ref, progress } = useElementProgress<HTMLDivElement>();
  return (
    <section id="component-9" className="demo-section">
      <DemoHeader
        number="09"
        title="Scroll Progress"
        description="An unobtrusive indicator makes long-form position instantly legible."
        meta="REAL-TIME · REQUESTANIMATIONFRAME"
      />
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
    </section>
  );
}

function PinZoomDemo() {
  const { ref, progress } = useElementProgress<HTMLDivElement>();
  const scale = 0.72 + progress * 0.28;
  const radius = 28 * (1 - progress);
  return (
    <section id="component-10" className="demo-section pin-section">
      <DemoHeader
        number="10"
        title="Image Pin & Zoom"
        description="A cinematic image holds its ground, then expands into the full frame as the story advances."
        meta="PINNED · SCALE .72 → 1 · GPU ACCELERATED"
      />
      <div ref={ref} className="pin-space">
        <div className="pin-sticky">
          <div
            className="pin-image"
            style={{
              transform: `scale(${scale})`,
              borderRadius: `${radius}px`,
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
    </section>
  );
}

function App() {
  const [pageProgress, setPageProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      setPageProgress(distance ? window.scrollY / distance : 0);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const scrollToComponents = () =>
    document.querySelector("#component-1")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="app-shell">
      <div className="page-progress" style={{ transform: `scaleX(${pageProgress})` }} />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Motion Lab home">
          <span className="brand-mark" />
          MOTION / LAB
        </a>
        <button
          type="button"
          className="menu-button"
          onClick={() => setMenuOpen((value) => !value)}
          aria-expanded={menuOpen}
        >
          {menuOpen ? "CLOSE" : "INDEX"} <span>{menuOpen ? "×" : "+"}</span>
        </button>
      </header>
      <nav className={`component-index ${menuOpen ? "is-open" : ""}`}>
        <span>COMPONENT INDEX</span>
        <div>
          {components.map((item, index) => (
            <a href={`#component-${index + 1}`} key={item} onClick={() => setMenuOpen(false)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {item}
            </a>
          ))}
        </div>
      </nav>

      <main id="top">
        <section className="hero">
          <div className="hero-noise" />
          <div className="hero-topline">
            <span>INTERACTION ARCHIVE</span>
            <span>BATCH / 05</span>
          </div>
          <div className="hero-title">
            <span className="hero-overline">10 COMPONENTS FOR THE</span>
            <h1>
              SCROLL
              <br />
              <em>STATE</em>
            </h1>
          </div>
          <p className="hero-copy">
            A field guide to meaningful movement. Built with native browser APIs, tuned for
            performance, and designed to respect the user.
          </p>
          <button type="button" className="explore-button" onClick={scrollToComponents}>
            <span>EXPLORE THE COLLECTION</span>
            <ArrowIcon down />
          </button>
          <div className="hero-spec">
            <span>VANILLA MOTION</span>
            <span>TOUCH READY</span>
            <span>REDUCED MOTION</span>
          </div>
        </section>

        <ScrollRevealDemo />
        <StaggeredGridDemo />
        <ParallaxDemo />
        <HorizontalStoryDemo />
        <StickyStoryDemo />
        <TextMaskDemo />
        <PageCurtainDemo />
        <CircularRevealDemo />
        <ProgressDemo />
        <PinZoomDemo />
      </main>
      <footer>
        <div>
          <span>MOTION / LAB</span>
          <p>Thoughtful motion for the modern web.</p>
        </div>
        <a href="#top">
          BACK TO TOP <ArrowIcon down />
        </a>
      </footer>
    </div>
  );
}

export default App;
