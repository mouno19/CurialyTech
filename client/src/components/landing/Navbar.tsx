import { useRef, useState, type MouseEvent } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Menu } from "lucide-react";
import { Wordmark } from "@/components/brand/Logo";
import { Dialog } from "@/components/common/Dialog";
import { ThemeMenu, useThemeOption } from "@/components/common/ThemeMenu";
import { useScrolled } from "@/lib/motion";
import { NAV_LINKS } from "./content";
import { scrollToAnchor } from "./primitives";

/** Fixed header: transparent over the hero, a paper surface with a rule once the page scrolls. */
/** The theme picker's round button (the menu names the choice). */
function ThemeButton() {
  const option = useThemeOption();
  return (
    <ThemeMenu>
      <button type="button" className="lp-nav-menu lp-nav-theme" aria-label={`Theme: ${option.label}`}>
        <option.icon size={18} aria-hidden="true" />
      </button>
    </ThemeMenu>
  );
}

export function Navbar({ signedIn }: { signedIn: boolean }) {
  const scrolled = useScrolled(12);
  const [menu, setMenu] = useState(false);
  // A section picked in the sheet is scrolled to (and focused) once the sheet has fully closed:
  // its scroll lock and aria-hidden are gone then, and focus is not handed back to the menu button.
  const pendingJump = useRef<string | null>(null);

  const jump = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (scrollToAnchor(href)) event.preventDefault();
  };
  const jumpFromMenu = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault();
    pendingJump.current = href;
    setMenu(false);
  };
  const afterMenuClosed = (event: Event) => {
    const href = pendingJump.current;
    pendingJump.current = null;
    if (href && document.getElementById(href.replace(/^#/, ""))) {
      event.preventDefault();
      scrollToAnchor(href);
    }
  };
  return (
    <header className="lp-nav" data-scrolled={scrolled || undefined}>
      <nav className="lp-container lp-nav-inner" aria-label="Main">
        <a href="#top" className="lp-nav-home" aria-label="Curialy AI, back to the top" onClick={event => jump(event, "#top")}>
          <Wordmark />
        </a>
        <ul className="lp-nav-links">
          {NAV_LINKS.map(link => (
            <li key={link.href}>
              <a href={link.href} className="ink-link" onClick={event => jump(event, link.href)}>{link.label}</a>
            </li>
          ))}
        </ul>
        <div className="lp-nav-actions">
          <ThemeButton />
          {signedIn ? (
            <Link href="/" className="lp-pill m-nudge">Open the workspace <ArrowUpRight size={16} aria-hidden="true" /></Link>
          ) : (
            <>
              <Link href="/login" className="lp-nav-signin">Sign in</Link>
              <a href="#composer" className="lp-pill m-nudge" onClick={event => jump(event, "#composer")}>Try Curialy <ArrowUpRight size={16} aria-hidden="true" /></a>
            </>
          )}
        </div>
        <div className="lp-nav-compact">
          <ThemeButton />
          <button type="button" className="lp-nav-menu" aria-label="Open the menu" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)}>
            <Menu size={20} aria-hidden="true" />
          </button>
        </div>
      </nav>
      <Dialog open={menu} onOpenChange={setMenu} side="right" size="sm" className="lp-sheet" onCloseAutoFocus={afterMenuClosed} title={<><Wordmark /><span className="sr-only">: menu</span></>}>
        <ul className="lp-sheet-links m-stagger">
          {NAV_LINKS.map((link, index) => (
            <li key={link.href}>
              <a href={link.href} onClick={event => jumpFromMenu(event, link.href)}>
                {link.label}
                <span className="lp-sheet-index" aria-hidden="true">0{index + 1}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="lp-sheet-actions">
          {signedIn ? (
            <Link href="/" className="lp-pill lp-pill-block">Open the workspace</Link>
          ) : (
            <>
              <a href="#composer" className="lp-pill lp-pill-block" onClick={event => jumpFromMenu(event, "#composer")}>Try Curialy</a>
              <Link href="/login" className="lp-pill lp-pill-block" data-variant="outline">Sign in</Link>
            </>
          )}
        </div>
      </Dialog>
    </header>
  );
}
