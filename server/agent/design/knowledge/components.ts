import type { DesignEntry } from "../types";

// Components, accessibility beyond the floor, and performance.

export const COMPONENTS: DesignEntry[] = [
  {
    id: "actions",
    title: "Buttons and actions",
    discipline: "components",
    rules: [
      "One primary action per view and a clear ladder: primary, secondary, tertiary (ghost), danger.",
      "Verb + noun labels in sentence case (\"Start free trial\", \"Add habit\"), not \"Submit\" or \"Learn more\" everywhere.",
      "Design every state: default, hover, focus-visible, active, disabled (with a reason), loading (label kept, spinner added).",
      "<button> for actions and <a href> for navigation; icon-only buttons need an aria-label, plus a tooltip on desktop.",
    ],
    sources: ["IBM Carbon buttons", "Vercel Web Interface Guidelines", "WAI-ARIA APG"],
  },
  {
    id: "navigation",
    title: "Navigation",
    discipline: "components",
    rules: [
      "Header: brand, 3-6 primary links and one primary action, 56-72 px tall; on phones a menu button (aria-expanded, aria-controls) opening a full-width panel; a skip link as the first focusable element.",
      "Show the current page or section with more than color (weight, underline, aria-current).",
      "Sticky headers never cover the focused element: scroll-padding-top equal to the header height.",
      "A footer only with real destinations; a one-page site does not need four columns of links.",
    ],
    sources: ["WAI-ARIA APG disclosure navigation", "WCAG 2.2 2.4.11", "GOV.UK header"],
  },
  {
    id: "forms",
    title: "Forms and signup",
    discipline: "components",
    needs: ["forms"],
    rules: [
      "Visible, persistent labels; the right type, inputmode and autocomplete; inputs at least 44 px tall with 16 px text on phones.",
      "Validate on submit and on blur, put the error text beside the field (aria-describedby), move focus to the first error, and never disable the submit button up front.",
      "A newsletter or signup form is one field and one button with clear consent text; success replaces the form and is announced in an aria-live region.",
      "Checkboxes and radios share one hit area with their label.",
    ],
    sources: ["GOV.UK Design System", "WCAG 2.2 1.3.5, 3.3.1, 3.3.8", "Vercel Web Interface Guidelines"],
  },
  {
    id: "overlays",
    title: "Dialogs, sheets and popovers",
    discipline: "components",
    signals: ["modal", "dialog", "quick view", "quickview", "sheet", "drawer", "popover", "lightbox", "cart", "menu", "overlay"],
    optional: true,
    rules: [
      "Use <dialog> with showModal() (focus containment, Escape, backdrop, inert page) or the popover attribute; return focus to the trigger on close; a visible close button with an accessible name.",
      "On phones, bottom sheets for short tasks (max-height about 90svh, a close button besides any drag handle) and full screen for long forms.",
      "Tooltips and hover cards can be dismissed with Escape, can be hovered, and also open on focus; essential information never lives only in a tooltip.",
      "Never open a modal on page load (newsletter, cookie or promo popups).",
    ],
    sources: ["WAI-ARIA APG dialog pattern", "MDN <dialog>", "WCAG 2.2 1.4.13"],
  },
  {
    id: "collections",
    title: "Grids and cards",
    discipline: "components",
    signals: ["grid", "gallery", "cards", "products", "collection", "catalog", "features", "list"],
    optional: true,
    rules: [
      "Grids use repeat(auto-fit, minmax(...)) with one image aspect ratio across items; each card is one clickable target (a stretched link) with secondary actions outside it.",
      "Vary treatment by hierarchy (a featured item may break the grid) instead of identical tiles; no tinted icon tile stacked above every feature heading.",
      "Icons: one set, inline SVG with currentColor, stroke weight matched to the adjacent text, aria-hidden when decorative; no emoji as UI icons.",
    ],
    sources: ["impeccable-catalogue", "Vercel Web Interface Guidelines", "anthropic-frontend-design-skill"],
  },
  {
    id: "data-display",
    title: "Tables and data states",
    discipline: "components",
    needs: ["data"],
    rules: [
      "Tables: tabular-nums, numbers end-aligned with units in the header, a sticky header on long tables, sortable columns as <button>s inside <th> with aria-sort; wide tables scroll inside a labelled, focusable container.",
      "Status is color plus a word or icon; dates, money and large numbers go through Intl.NumberFormat and Intl.DateTimeFormat with one precision per column.",
      "Design empty, loading (a skeleton after about 200 ms) and error states, each with a next action.",
    ],
    sources: ["IBM Carbon data table", "WAI-ARIA APG sortable table", "Vercel Web Interface Guidelines"],
  },
  {
    id: "charts",
    title: "Charts and KPIs",
    discipline: "components",
    needs: ["data"],
    rules: [
      "Pick the chart by the question: a trend over time is a line or area; comparing categories is sorted horizontal bars; a part of a whole with 2-3 parts can be a donut, otherwise a stacked bar; a distribution is a histogram.",
      "Label directly instead of legends where possible; muted gridlines; bars start at zero; one highlighted series in the accent and the rest neutral; color-blind-safe hues, never color alone.",
      "KPI tiles: the value with its unit, a comparison (change against the previous period, direction in words or an arrow, not only red and green) and the period.",
      "Use a chart library already in the project, or plain SVG; charts keep an aspect ratio, resize with their container, and have a text summary or table alternative.",
    ],
    sources: ["Datawrapper chart guidance", "IBM Carbon data visualization", "WCAG 2.2 1.4.1, 1.1.1"],
  },
  {
    id: "accessibility-depth",
    title: "Keyboard and assistive technology",
    discipline: "accessibility",
    signals: ["accessible", "accessibility", "a11y", "wcag", "keyboard", "screen reader"],
    optional: true,
    rules: [
      "Everything works with Tab, Enter, Space and Escape; arrow keys with a roving tabindex inside tabs, menus and radio groups; no positive tabindex; DOM order matches visual order.",
      "Custom controls get the role and the behavior: a color or size picker is a radio group (role=radiogroup, named radios, aria-checked), a toggle is a switch or a pressed button.",
      "Announce async results (added to cart, saved, errors) through a polite aria-live region.",
      "Respect prefers-contrast and forced colors: real borders and outlines, not only shadows or gradients, mark boundaries.",
    ],
    sources: ["WAI-ARIA APG", "WCAG 2.2 2.1.1, 4.1.2, 4.1.3", "MDN forced-colors"],
  },
  {
    id: "performance",
    title: "Performance budget",
    discipline: "performance",
    rules: [
      "Targets: LCP 2.5 s or less, CLS 0.1 or less, INP 200 ms or less on a mid-range phone.",
      "The hero is in the initial HTML; fetchpriority=\"high\" on the one hero image; never loading=\"lazy\" above the fold, always below it.",
      "Reserve space for images, embeds and late content (width/height or aspect-ratio); never insert content above what is already shown.",
      "Prefer CSS and platform features to libraries; no large dependency for one effect; keep the DOM under about 1,500 nodes; avoid backdrop-filter and large blurred shadows on big or scrolling areas.",
    ],
    sources: ["web.dev Core Web Vitals", "web.dev optimize LCP", "Lighthouse DOM size", "The Performance Inequality Gap 2026"],
  },
];
