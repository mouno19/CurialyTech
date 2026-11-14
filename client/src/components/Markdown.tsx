import { memo, useMemo } from "react";
import DOMPurify, { type Config } from "dompurify";
import { Marked, Renderer, type Tokens } from "marked";
import type { WebSource } from "@shared/agent";
import { looksLikeBuildOutput } from "@shared/generated";
import { canonicalSourceUrl } from "@shared/sources";
import { highlight } from "@/lib/highlight";
import { cx } from "@/components/common/cx";

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? "").trim().split(/\s+/)[0];
      // Ink panel: the highlight colours are tuned for it.
      const block = `<pre class="code-block"><code class="hljs${language ? ` language-${escapeAttr(language)}` : ""}">${highlight(text, language || undefined)}</code></pre>`;
      if (!looksLikeBuildOutput(text)) return block;
      // Routine build/install chatter stays available but out of the way.
      const lines = text.split("\n").filter(line => line.trim()).length;
      return `<details class="build-log"><summary>Build output · ${lines} line${lines === 1 ? "" : "s"}</summary>${block}</details>`;
    },
    table(this: Renderer, token: Tokens.Table) {
      // A wide table scrolls inside its own region (keyboard-focusable) instead of widening the page.
      return `<div class="md-table" role="region" aria-label="Table" tabindex="0">${Renderer.prototype.table.call(this, token)}</div>`;
    },
    link(this: Renderer, { href, title, tokens }: Tokens.Link) {
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer noopener"${title ? ` title="${escapeAttr(title)}"` : ""}>${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

/**
 * Model output is untrusted. Beyond DOMPurify's script/handler removal: no forms or form controls
 * (a convincing fake login inside an answer), no <style> or style attributes (an answer must not
 * restyle the app), no embedded objects, and no remote images (they would load automatically and
 * tell a third party when the page was read). GFM task-list checkboxes stay, disabled.
 */
const SANITIZE: Config & { RETURN_DOM_FRAGMENT: true } = {
  ADD_TAGS: ["details", "summary"],
  ADD_ATTR: ["target", "tabindex", "role", "aria-label"],
  FORBID_TAGS: ["style", "form", "button", "textarea", "select", "option", "optgroup", "datalist", "fieldset", "dialog", "iframe", "object", "embed", "link", "meta", "base"],
  FORBID_ATTR: ["style", "action", "formaction", "form", "method", "srcset"],
  RETURN_DOM_FRAGMENT: true,
};

const isLocalImage = (src: string) => src.startsWith("data:image/") || src.startsWith("blob:") || (src.startsWith("/") && !src.startsWith("//"));

/**
 * Citations in an answer: a link to one of the task's web search results becomes a numbered chip
 * (the number of that URL, whatever the link text said), or keeps its text with the number after
 * it. A bare-number link to anything else is marked as not a search result. Model output can't
 * fake a chip: the classes and attributes the decoration uses are removed first.
 */
function decorateCitations(root: DocumentFragment, sources: WebSource[]) {
  for (const element of Array.from(root.querySelectorAll(".cite, [data-cite], [data-cite-n], [data-cite-unverified]"))) {
    element.classList.remove("cite");
    for (const name of ["data-cite", "data-cite-n", "data-cite-unverified"]) element.removeAttribute(name);
  }
  const byKey = new Map(sources.map(source => [canonicalSourceUrl(source.url), source]));
  for (const link of Array.from(root.querySelectorAll("a[href]"))) {
    const href = link.getAttribute("href") ?? "";
    const target = canonicalSourceUrl(href);
    const source = target ? byKey.get(target) : undefined;
    const bare = /^\[?\d{1,3}\]?$/.test((link.textContent ?? "").trim());
    if (source) {
      const label = `Source ${source.n}: ${source.title} (${source.source})`;
      link.classList.add("cite");
      link.setAttribute("title", `${source.source}: ${source.title}`);
      if (bare) {
        link.textContent = String(source.n);
        link.setAttribute("data-cite", "");
        link.setAttribute("aria-label", `${label}, opens in a new tab`);
      } else {
        link.setAttribute("data-cite-n", String(source.n));
      }
    } else if (bare && /^https?:/i.test(href)) {
      link.setAttribute("data-cite-unverified", "");
      link.setAttribute("title", "Not one of this task's web search results");
    }
  }
}

function sanitize(html: string, sources?: WebSource[]) {
  const fragment = DOMPurify.sanitize(html, SANITIZE);
  if (sources) decorateCitations(fragment, sources);
  for (const input of Array.from(fragment.querySelectorAll("input"))) {
    if (input.getAttribute("type") === "checkbox") input.setAttribute("disabled", "");
    else input.remove();
  }
  for (const image of Array.from(fragment.querySelectorAll("img"))) {
    const src = image.getAttribute("src") ?? "";
    if (isLocalImage(src)) continue;
    const link = document.createElement("a");
    if (/^https?:\/\//i.test(src)) {
      link.setAttribute("href", src);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noreferrer noopener");
    }
    link.textContent = `Image: ${image.getAttribute("alt") || src.replace(/^https?:\/\//i, "").slice(0, 80) || "external image"}`;
    image.replaceWith(link);
  }
  const host = document.createElement("div");
  host.appendChild(fragment);
  return host.innerHTML;
}

const sourcesKey = (sources?: WebSource[]) => (sources ? sources.map(source => `${source.n} ${source.url}`).join("\n") : null);

type MarkdownProps = {
  text: string;
  className?: string;
  /** The task's web search results: links to them render as citations (see decorateCitations). */
  sources?: WebSource[];
};

export const Markdown = memo(function Markdown({ text, className, sources }: MarkdownProps) {
  const key = sourcesKey(sources);
  const html = useMemo(() => sanitize(marked.parse(text, { async: false }) as string, sources), [text, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className={cx("markdown", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}, (a, b) => a.text === b.text && a.className === b.className && sourcesKey(a.sources) === sourcesKey(b.sources));
