/**
 * Export Service (M4C — Advanced Exports)
 *
 * Free tier (table stakes): SVG / PNG / PDF of a single diagram.
 * Premium tier (gated via requirePremium("advancedExports")):
 *   - high-resolution PNG (3× / 4×)
 *   - copy PNG as a data URI
 *   - Markdown bundle (.md with fenced ```mermaid)
 *   - batch export of the whole local history
 *
 * Rasterization happens in RenderService's webview (the only place mermaid can
 * run). PDF is assembled here from a JPEG the renderer produces, embedded with
 * DCTDecode — no extra dependency.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Diagram, DiagramCategory } from "../types";
import { RenderService } from "./render-service";
import { requirePremium, PremiumGateDeps } from "./premium-gate";
import { getLogger } from "../utils/logger";

type ExportChoice =
  | { kind: "svg" }
  | { kind: "png"; scale: number }
  | { kind: "pdf" }
  | { kind: "copyDataUri" }
  | { kind: "markdown" }
  | { kind: "batch" };

interface ExportItem extends vscode.QuickPickItem {
  choice: ExportChoice;
  premium?: boolean;
}

const WHITE = "#ffffff";

export class ExportService {
  constructor(
    private readonly render: RenderService,
    private readonly gate: PremiumGateDeps,
    private readonly listDiagrams: () => Diagram[]
  ) {}

  /** Entry point for the `flowcraft.exportDiagram` command. */
  async exportDiagram(diagram: Diagram): Promise<void> {
    if (diagram.category !== DiagramCategory.Mermaid) {
      await this.exportNonMermaid(diagram);
      return;
    }

    const items: ExportItem[] = [
      { label: "SVG", description: "vector · scales cleanly", choice: { kind: "svg" } },
      { label: "PNG", description: "raster · 2×", choice: { kind: "png", scale: 2 } },
      { label: "PDF", description: "single page", choice: { kind: "pdf" } },
      { label: "PNG · high-res 3× (Premium)", description: "crisp for slides", choice: { kind: "png", scale: 3 }, premium: true },
      { label: "PNG · high-res 4× (Premium)", description: "print quality", choice: { kind: "png", scale: 4 }, premium: true },
      { label: "Copy as data URI (Premium)", description: "embed anywhere", choice: { kind: "copyDataUri" }, premium: true },
      { label: "Markdown bundle (Premium)", description: "fenced ```mermaid", choice: { kind: "markdown" }, premium: true },
      { label: "Export entire history… (Premium)", description: "every saved diagram", choice: { kind: "batch" }, premium: true },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: `FlowCraft · export "${diagram.title || "diagram"}"`,
      placeHolder: "Choose an export format",
      matchOnDescription: true,
    });
    if (!picked) {
      return;
    }

    if (picked.premium) {
      const entitled = await requirePremium("advancedExports", this.gate, {
        featureLabel: "Advanced exports",
      });
      if (!entitled) {
        return;
      }
    }

    try {
      switch (picked.choice.kind) {
        case "svg":
          await this.exportSingle(diagram, "svg");
          break;
        case "png":
          await this.exportSingle(diagram, "png", picked.choice.scale);
          break;
        case "pdf":
          await this.exportSingle(diagram, "pdf");
          break;
        case "copyDataUri":
          await this.copyAsDataUri(diagram);
          break;
        case "markdown":
          await this.exportMarkdownBundle(diagram);
          break;
        case "batch":
          await this.batchExport();
          break;
      }
    } catch (err) {
      getLogger().error("ExportService: export failed", err);
      vscode.window.showErrorMessage(
        `FlowCraft: export failed · ${(err as Error).message}`
      );
    }
  }

  /** Render + write a single diagram in svg/png/pdf to a user-chosen path. */
  private async exportSingle(
    diagram: Diagram,
    format: "svg" | "png" | "pdf",
    scale = 2
  ): Promise<void> {
    const ext = format;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(this.safeFileName(diagram.title, ext)),
      filters: this.filtersFor(format),
    });
    if (!uri) {
      return;
    }

    const bytes = await this.produceBytes(diagram, format, scale);
    await fs.promises.writeFile(uri.fsPath, bytes);

    const action = await vscode.window.showInformationMessage(
      `FlowCraft: exported to ${path.basename(uri.fsPath)}`,
      "Reveal"
    );
    if (action === "Reveal") {
      await vscode.commands.executeCommand("revealFileInOS", uri);
    }
  }

  /** Produce the raw file bytes for one diagram in the given format. */
  private async produceBytes(
    diagram: Diagram,
    format: "svg" | "png" | "pdf",
    scale: number
  ): Promise<Buffer> {
    if (format === "svg") {
      const res = await this.render.renderExport(diagram, "svg");
      return Buffer.from(res.payload, "utf8");
    }
    if (format === "png") {
      const res = await this.render.renderExport(diagram, "png", scale);
      return dataUrlToBuffer(res.payload);
    }
    // PDF: render a JPEG (white background — JPEG has no alpha) and embed it.
    const res = await this.render.renderExport(diagram, "jpeg", scale, WHITE);
    const jpeg = dataUrlToBuffer(res.payload);
    return jpegToPdf(jpeg, res.width, res.height);
  }

  private async copyAsDataUri(diagram: Diagram): Promise<void> {
    const res = await this.render.renderExport(diagram, "png", 2);
    await vscode.env.clipboard.writeText(res.payload);
    vscode.window.showInformationMessage(
      "FlowCraft: PNG data URI copied to clipboard."
    );
  }

  private async exportMarkdownBundle(diagram: Diagram): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(this.safeFileName(diagram.title, "md")),
      filters: { Markdown: ["md"] },
    });
    if (!uri) {
      return;
    }
    const md =
      `# ${diagram.title || "Diagram"}\n\n` +
      (diagram.description ? `${diagram.description}\n\n` : "") +
      "```mermaid\n" +
      `${(diagram.content ?? "").trim()}\n` +
      "```\n";
    await fs.promises.writeFile(uri.fsPath, md, "utf8");
    vscode.window.showInformationMessage(
      `FlowCraft: Markdown bundle saved to ${path.basename(uri.fsPath)}`
    );
  }

  private async batchExport(): Promise<void> {
    const diagrams = this.listDiagrams().filter(
      (d) => d.category === DiagramCategory.Mermaid && (d.content ?? "").trim().length > 0
    );
    if (diagrams.length === 0) {
      vscode.window.showInformationMessage("FlowCraft: no Mermaid diagrams to export.");
      return;
    }

    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Export here",
      title: "FlowCraft · choose a folder for the batch export",
    });
    if (!folders || folders.length === 0) {
      return;
    }
    const dir = folders[0].fsPath;

    const format = await vscode.window.showQuickPick(
      [
        { label: "PNG (2×)", value: "png" as const },
        { label: "SVG", value: "svg" as const },
      ],
      { title: "FlowCraft · batch format", placeHolder: "Format for all diagrams" }
    );
    if (!format) {
      return;
    }

    let ok = 0;
    let failed = 0;
    const used = new Set<string>();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "FlowCraft: exporting history…",
        cancellable: true,
      },
      async (progress, token) => {
        const step = 100 / diagrams.length;
        for (const diagram of diagrams) {
          if (token.isCancellationRequested) {
            break;
          }
          progress.report({
            increment: step,
            message: diagram.title || diagram.id,
          });
          try {
            const bytes = await this.produceBytes(diagram, format.value, 2);
            const name = this.uniqueName(used, diagram.title || diagram.id, format.value);
            await fs.promises.writeFile(path.join(dir, name), bytes);
            ok++;
          } catch (err) {
            failed++;
            getLogger().error(`ExportService: batch item failed (${diagram.id})`, err);
          }
        }
      }
    );

    vscode.window.showInformationMessage(
      `FlowCraft: exported ${ok} diagram${ok === 1 ? "" : "s"}` +
        (failed > 0 ? ` · ${failed} failed` : "") +
        ` to ${dir}`
    );
  }

  /** SVG-category diagrams export their markup directly; images copy their URL. */
  private async exportNonMermaid(diagram: Diagram): Promise<void> {
    if (diagram.category === DiagramCategory.SVG) {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(this.safeFileName(diagram.title, "svg")),
        filters: { SVG: ["svg"] },
      });
      if (!uri) {
        return;
      }
      await fs.promises.writeFile(uri.fsPath, diagram.content ?? "", "utf8");
      vscode.window.showInformationMessage(
        `FlowCraft: exported to ${path.basename(uri.fsPath)}`
      );
      return;
    }
    // Image diagrams are remote URLs.
    await vscode.env.clipboard.writeText(diagram.content ?? "");
    vscode.window.showInformationMessage("FlowCraft: image URL copied to clipboard.");
  }

  private filtersFor(format: "svg" | "png" | "pdf"): { [name: string]: string[] } {
    switch (format) {
      case "svg":
        return { SVG: ["svg"] };
      case "png":
        return { "PNG image": ["png"] };
      case "pdf":
        return { PDF: ["pdf"] };
    }
  }

  private safeFileName(title: string, ext: string): string {
    const base = (title || "diagram")
      .replace(/[^a-z0-9_\-]/gi, "_")
      .replace(/_+/g, "_")
      .toLowerCase()
      .slice(0, 64) || "diagram";
    return `${base}.${ext}`;
  }

  private uniqueName(used: Set<string>, title: string, ext: string): string {
    let name = this.safeFileName(title, ext);
    let n = 1;
    while (used.has(name)) {
      const base = name.replace(new RegExp(`\\.${ext}$`), "");
      name = `${base}_${n++}.${ext}`;
    }
    used.add(name);
    return name;
  }
}

/** Decode a "data:...;base64,XXXX" URL into raw bytes. */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Buffer.from(b64, "base64");
}

/**
 * Wrap a JPEG into a minimal single-page PDF using DCTDecode (PDF can embed
 * JPEG bytes verbatim). Page size = image pixel size, treated as points.
 */
function jpegToPdf(jpeg: Buffer, width: number, height: number): Buffer {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const push = (chunk: string | Buffer): void => {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "latin1") : chunk;
    parts.push(buf);
    cursor += buf.length;
  };
  const startObject = (n: number): void => {
    offsets[n] = cursor;
  };

  push("%PDF-1.4\n");

  startObject(1);
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject(2);
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  startObject(3);
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  startObject(4);
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${jpeg.length} >>\nstream\n`
  );
  push(jpeg);
  push("\nendstream\nendobj\n");

  const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
  startObject(5);
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  const xrefStart = cursor;
  const count = 6; // objects 0..5
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.concat(parts);
}
