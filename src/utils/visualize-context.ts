/** Generation input cap shared across the extension (CLAUDE.md "Size limits"). */
export const MAX_CONTEXT_CHARS = 10000;

export interface FolderFile {
  relPath: string;
  text: string;
}

/** Lines that signal structure for an architecture diagram. */
function structuralLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) =>
      /^(import\b|export\b|from\b|class\b|interface\b|def\b|function\b)/.test(l)
    );
}

/**
 * Single file / selection just uses raw code (capped). Folders are summarized
 * into a file tree + per-file structural lines (imports/exports/declarations),
 * because raw concatenation blows the 10k cap immediately.
 */
export function buildFileContext(text: string): string {
  return text.length > MAX_CONTEXT_CHARS ? text.slice(0, MAX_CONTEXT_CHARS) : text;
}

export function summarizeFolder(rootName: string, files: FolderFile[]): string {
  const header = `Project folder "${rootName}" structure:\n`;
  const parts: string[] = [header];
  let truncated = false;

  for (const f of files) {
    const block = [`\n## ${f.relPath}`, ...structuralLines(f.text)].join("\n");
    if (parts.join("\n").length + block.length > MAX_CONTEXT_CHARS - 40) {
      truncated = true;
      break;
    }
    parts.push(block);
  }

  if (truncated) {
    parts.push("\n(…truncated: folder too large to include in full.)");
  }
  return parts.join("\n").slice(0, MAX_CONTEXT_CHARS);
}
