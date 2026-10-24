import { memo, useMemo } from "react";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { highlight } from "@/lib/highlight";

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? "").trim().split(/\s+/)[0];
      return `<pre><code class="hljs${language ? ` language-${language}` : ""}">${highlight(text, language || undefined)}</code></pre>`;
    },
    link({ href, title, text }) {
      return `<a href="${href}" target="_blank" rel="noreferrer noopener"${title ? ` title="${title}"` : ""}>${text}</a>`;
    },
  },
});

/** Model output is untrusted: render Markdown, then sanitize before it touches the DOM. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { ADD_ATTR: ["target"] }), [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
});
