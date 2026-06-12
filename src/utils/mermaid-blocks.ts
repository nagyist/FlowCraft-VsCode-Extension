export interface MermaidBlock {
  /** 0-based line of the opening ```mermaid fence. */
  fenceStartLine: number;
  /** 0-based line of the closing ``` fence. */
  fenceEndLine: number;
  /** The Mermaid source between the fences (no trailing newline). */
  code: string;
}

/** Parse fenced ```mermaid blocks out of Markdown text. Pure + line-based. */
export function findMermaidBlocks(text: string): MermaidBlock[] {
  const lines = text.split("\n");
  const blocks: MermaidBlock[] = [];
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (start === -1) {
      if (/^```mermaid\b/.test(trimmed)) {
        start = i;
      }
    } else if (trimmed === "```") {
      blocks.push({
        fenceStartLine: start,
        fenceEndLine: i,
        code: lines.slice(start + 1, i).join("\n"),
      });
      start = -1;
    }
  }
  return blocks;
}
