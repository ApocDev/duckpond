import { expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageMarkdown } from "./message-markdown";

it("renders saved GFM tables in a scroll container and keeps raw HTML inert", () => {
  const html = renderToStaticMarkup(
    <MessageMarkdown>
      {"| Lane | Unlock |\n|---|---|\n| Markets | Contracts |\n\n<script>alert(1)</script>"}
    </MessageMarkdown>,
  );
  expect(html).toContain('class="table-scroll"');
  expect(html).toContain("<th>Lane</th>");
  expect(html).toContain("<td>Contracts</td>");
  expect(html).not.toContain("<script>");
});
it("keeps streaming Mermaid as code and defers completed diagrams to the browser", () => {
  const source = "```mermaid\nflowchart LR\n A-->B\n```";
  const streaming = renderToStaticMarkup(
    <MessageMarkdown complete={false}>{source}</MessageMarkdown>,
  );
  expect(streaming).toContain("language-mermaid");
  expect(streaming).not.toContain("mermaid-diagram");
  const complete = renderToStaticMarkup(<MessageMarkdown>{source}</MessageMarkdown>);
  expect(complete).toContain("mermaid-diagram");
  expect(complete).not.toContain("<svg");
  expect(complete).toContain("A--&gt;B");
});
