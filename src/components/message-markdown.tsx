import { isValidElement, memo, useEffect, useRef, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

let renderer: Promise<(typeof import("mermaid"))["default"]> | undefined;
function loadRenderer() {
  return (renderer ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      suppressErrorRendering: true,
    });
    return mermaid;
  }));
}

/** Render completed diagrams only when visible. Typing and streamed tokens never redraw them. */
const MermaidDiagram = memo(function MermaidDiagram({ source }: { source: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ source: string; svg?: string; error?: boolean }>();
  useEffect(() => {
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void (async () => {
        try {
          const mermaid = await loadRenderer();
          if (cancelled) return;
          const { svg } = await mermaid.render(`duck-diagram-${crypto.randomUUID()}`, source);
          const document = new DOMParser().parseFromString(svg, "image/svg+xml");
          const root = document.documentElement;
          const width = Number(root.getAttribute("viewBox")?.split(/\s+/)[2]);
          if (width > 0) {
            root.style.width = `${width}px`;
            root.style.maxWidth = "none";
          }
          if (!cancelled) setResult({ source, svg: new XMLSerializer().serializeToString(root) });
        } catch {
          if (!cancelled) setResult({ source, error: true });
        }
      })();
    });
    if (container.current) observer.observe(container.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [source]);
  const current = result?.source === source ? result : undefined;
  return (
    <div className="mermaid-diagram" ref={container}>
      {current?.svg ? (
        <>
          <div
            className="diagram-scroll"
            role="img"
            aria-label="Discussion diagram"
            dangerouslySetInnerHTML={{ __html: current.svg }}
          />
          <details>
            <summary>Diagram source</summary>
            <pre>
              <code>{source}</code>
            </pre>
          </details>
        </>
      ) : (
        <>
          {current?.error && <small>Could not draw this diagram. Its source is shown below.</small>}
          <pre>
            <code>{source}</code>
          </pre>
        </>
      )}
    </div>
  );
});

const components: Components = {
  table({ children }) {
    return (
      <div className="table-scroll" role="region" aria-label="Table" tabIndex={0}>
        <table>{children}</table>
      </div>
    );
  },
};
const diagramComponents: Components = {
  ...components,
  pre({ children }) {
    if (
      isValidElement<{ className?: string; children?: ReactNode }>(children) &&
      children.props.className === "language-mermaid" &&
      typeof children.props.children === "string"
    )
      return <MermaidDiagram source={children.props.children.trimEnd()} />;
    return <pre>{children}</pre>;
  },
};
const plugins = [remarkGfm];
export const MessageMarkdown = memo(function MessageMarkdown({
  children,
  complete = true,
}: {
  children: string;
  complete?: boolean;
}) {
  return (
    <Markdown remarkPlugins={plugins} components={complete ? diagramComponents : components}>
      {children}
    </Markdown>
  );
});
