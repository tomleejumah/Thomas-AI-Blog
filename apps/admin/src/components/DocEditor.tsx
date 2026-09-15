"use client";

import { useEffect, useRef } from "react";

type Props = {
  html: string;
  onChange: (html: string) => void;
};

function run(cmd: string, value?: string) {
  document.execCommand(cmd, false, value);
}

export default function DocEditor({ html, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = html || "<p></p>";
    }
  }, [html]);

  return (
    <div className="doc-shell">
      <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("bold")}>
          B
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("italic")}>
          <em>I</em>
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("underline")}>
          U
        </button>
        <span className="doc-sep" />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("formatBlock", "H2")}>
          H2
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("formatBlock", "H3")}>
          H3
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("formatBlock", "P")}>
          P
        </button>
        <span className="doc-sep" />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("insertUnorderedList")}>
          • List
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("insertOrderedList")}>
          1. List
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run("formatBlock", "BLOCKQUOTE")}>
          Quote
        </button>
      </div>
      <div
        ref={ref}
        className="rich-editor doc-page"
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
      />
    </div>
  );
}
