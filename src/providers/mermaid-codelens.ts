import * as vscode from "vscode";
import { findMermaidBlocks } from "../utils/mermaid-blocks";

/**
 * Shows "Preview" / "Refine" CodeLenses above each ```mermaid block in Markdown.
 * The lenses dispatch to commands registered in extension.ts, passing the
 * document URI + the block's fence line range.
 */
export class MermaidCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (const block of findMermaidBlocks(document.getText())) {
      const range = new vscode.Range(block.fenceStartLine, 0, block.fenceStartLine, 0);
      const args = [document.uri, block.fenceStartLine, block.fenceEndLine];
      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(eye) Preview",
          command: "flowcraft.previewMermaidBlock",
          arguments: args,
        }),
        new vscode.CodeLens(range, {
          title: "$(sparkle) Refine",
          command: "flowcraft.refineMermaidBlock",
          arguments: args,
        })
      );
    }
    return lenses;
  }
}
