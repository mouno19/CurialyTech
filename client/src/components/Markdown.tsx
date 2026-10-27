import { memo, useMemo } from "react";
import DOMPurify, { type Config } from "dompurify";
import { Marked, Renderer, type Tokens } from "marked";
import { looksLikeBuildOutput } from "@shared/generated";
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

function sanitize(html: string) {
  const fragment = DOMPurify.sanitize(html, SANITIZE);
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

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => sanitize(marked.parse(text, { async: false }) as string), [text]);
  return <div className={cx("markdown", className)} dangerouslySetInnerHTML={{ __html: html }} />;
});
