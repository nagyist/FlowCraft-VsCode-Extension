/**
 * Render Service — the single mermaid rendering surface for the extension.
 *
 * It owns one reusable WebviewPanel that:
 *   - renders a diagram's mermaid into an SVG (the in-extension *viewer*, M6A), and
 *   - produces export artifacts (SVG / PNG / JPEG) from the rendered diagram (M4C).
 *
 * VS Code has no truly headless webview, so exports render through this same
 * (visible) panel rather than a flashing throwaway one. PDF is assembled in the
 * extension from a JPEG produced here (see ExportService).
 *
 * Generation is never touched here — it stays free + BYOK.
 */

import * as vscode from "vscode";
import { getNonce, getThemeKind } from "../utils/webview-utils";
import { getLogger } from "../utils/logger";
import { Diagram, DiagramCategory } from "../types";

const RENDER_TIMEOUT_MS = 20000;
const EXPORT_TIMEOUT_MS = 20000;

export type ExportArtifactFormat = "svg" | "png" | "jpeg";

export interface RenderExportResult {
  format: ExportArtifactFormat;
  /** SVG markup for "svg"; a base64 data URL ("data:image/...") for png/jpeg. */
  payload: string;
  width: number;
  height: number;
}

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RenderService implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private current: Diagram | undefined;
  private themeOverride: "light" | "dark" | undefined;

  private ready: Promise<void> | undefined;
  private readyResolve: (() => void) | undefined;
  private renderWaiter: Waiter<void> | undefined;
  private pending = new Map<string, Waiter<RenderExportResult>>();
  private reqCounter = 0;

  private disposables: vscode.Disposable[] = [];

  /** Wired by extension.ts so the viewer's "Export" toolbar button runs the export flow. */
  public onExportRequested: ((diagram: Diagram) => void | Promise<void>) | undefined;
  /** Wired by extension.ts so "Open on web" can resolve the right URL (or undefined). */
  public webUrlFor: ((diagram: Diagram) => string | undefined) | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Reveal the viewer panel and render `diagram` (the interactive in-extension viewer). */
  async view(diagram: Diagram): Promise<void> {
    if (diagram.category !== DiagramCategory.Mermaid) {
      vscode.window.showInformationMessage(
        "FlowCraft: in-extension preview is available for Mermaid diagrams."
      );
      return;
    }
    this.current = diagram;
    this.themeOverride = undefined;
    const panel = this.ensurePanel();
    panel.title = `FlowCraft · ${diagram.title || "diagram"}`;
    panel.reveal(vscode.ViewColumn.Beside, false);
    try {
      await this.renderCurrent();
    } catch (err) {
      vscode.window.showErrorMessage(
        `FlowCraft: couldn't render diagram · ${(err as Error).message}`
      );
    }
  }

  /**
   * Render `diagram` and return an export artifact. Reuses the viewer panel
   * (revealed without stealing focus) so there is no throwaway-panel flash.
   */
  async renderExport(
    diagram: Diagram,
    format: ExportArtifactFormat,
    scale = 1,
    background?: string
  ): Promise<RenderExportResult> {
    if (diagram.category !== DiagramCategory.Mermaid) {
      throw new Error("Only Mermaid diagrams can be rendered for export.");
    }
    this.current = diagram;
    const panel = this.ensurePanel();
    panel.reveal(panel.viewColumn ?? vscode.ViewColumn.Beside, true);
    await this.renderCurrent();
    return this.requestExport(format, scale, background);
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) {
      return this.panel;
    }

    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    const panel = vscode.window.createWebviewPanel(
      "flowcraft.viewer",
      "FlowCraft · diagram",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "media"),
          vscode.Uri.joinPath(this.extensionUri, "node_modules"),
        ],
      }
    );

    panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      undefined,
      this.disposables
    );

    panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.ready = undefined;
        this.readyResolve = undefined;
        this.failAllPending(new Error("Viewer panel was closed."));
      },
      undefined,
      this.disposables
    );

    // Re-render on theme change unless the user pinned a theme via the toolbar.
    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        if (!this.themeOverride && this.panel && this.current) {
          void this.renderCurrent().catch(() => {
            /* transient — ignore */
          });
        }
      })
    );

    panel.webview.html = this.getHtml(panel.webview);
    this.panel = panel;
    return panel;
  }

  private async renderCurrent(): Promise<void> {
    const panel = this.ensurePanel();
    if (this.ready) {
      await this.ready;
    }
    const theme = this.themeOverride ?? getThemeKind();

    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.renderWaiter = undefined;
        reject(new Error("Render timed out."));
      }, RENDER_TIMEOUT_MS);
      this.renderWaiter = { resolve, reject, timer };
    });

    panel.webview.postMessage({
      command: "render",
      data: { code: this.current?.content ?? "", theme },
    });

    await done;
  }

  private requestExport(
    format: ExportArtifactFormat,
    scale: number,
    background: string | undefined
  ): Promise<RenderExportResult> {
    const panel = this.ensurePanel();
    const requestId = `r${++this.reqCounter}`;
    return new Promise<RenderExportResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Export timed out."));
      }, EXPORT_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      panel.webview.postMessage({
        command: "produceExport",
        data: { requestId, format, scale, background },
      });
    });
  }

  private handleMessage(msg: any): void {
    const command = msg?.command;
    const data = msg?.data ?? {};

    switch (command) {
      case "ready": {
        this.readyResolve?.();
        break;
      }
      case "rendered": {
        const waiter = this.renderWaiter;
        this.renderWaiter = undefined;
        if (!waiter) {
          break;
        }
        clearTimeout(waiter.timer);
        if (data.ok) {
          waiter.resolve();
        } else {
          waiter.reject(new Error(data.error || "Mermaid render failed."));
        }
        break;
      }
      case "exportResult": {
        const waiter = this.pending.get(data.requestId);
        if (!waiter) {
          break;
        }
        this.pending.delete(data.requestId);
        clearTimeout(waiter.timer);
        if (data.ok) {
          waiter.resolve({
            format: data.format,
            payload: data.payload,
            width: data.width ?? 0,
            height: data.height ?? 0,
          });
        } else {
          waiter.reject(new Error(data.error || "Export failed."));
        }
        break;
      }
      case "toolbar": {
        void this.handleToolbar(data.action);
        break;
      }
      default:
        break;
    }
  }

  private async handleToolbar(action: string): Promise<void> {
    const diagram = this.current;
    if (!diagram) {
      return;
    }
    switch (action) {
      case "copyCode":
        await vscode.env.clipboard.writeText(diagram.content ?? "");
        vscode.window.showInformationMessage("FlowCraft: diagram code copied.");
        break;
      case "export":
        if (this.onExportRequested) {
          await this.onExportRequested(diagram);
        }
        break;
      case "toggleTheme": {
        const currently = this.themeOverride ?? getThemeKind();
        this.themeOverride = currently === "dark" ? "light" : "dark";
        await this.renderCurrent().catch((err) =>
          getLogger().error("RenderService: theme re-render failed", err)
        );
        break;
      }
      case "openWeb": {
        const url = this.webUrlFor?.(diagram);
        if (url) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        } else {
          vscode.window.showInformationMessage(
            "FlowCraft: this diagram isn't synced to the web yet."
          );
        }
        break;
      }
      default:
        break;
    }
  }

  private failAllPending(err: Error): void {
    if (this.renderWaiter) {
      clearTimeout(this.renderWaiter.timer);
      this.renderWaiter.reject(err);
      this.renderWaiter = undefined;
    }
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.pending.clear();
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "node_modules",
        "mermaid",
        "dist",
        "mermaid.min.js"
      )
    );
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FlowCraft diagram</title>
  <style>
    :root { color-scheme: light dark; }
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex; flex-direction: column;
    }
    .toolbar {
      display: flex; gap: 6px; align-items: center;
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      flex: 0 0 auto;
    }
    .toolbar button {
      font: inherit; cursor: pointer;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));
      border-radius: 4px; padding: 4px 10px;
    }
    .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.18)); }
    .toolbar .spacer { flex: 1 1 auto; }
    .stage { flex: 1 1 auto; overflow: auto; padding: 16px; }
    #diagram { display: flex; justify-content: center; }
    #diagram svg { max-width: 100%; height: auto; }
    .err {
      white-space: pre-wrap; color: var(--vscode-errorForeground, #f14c4c);
      font-family: var(--vscode-editor-font-family, monospace); padding: 12px;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="tb-copy" title="Copy Mermaid code">Copy code</button>
    <button id="tb-export" title="Export this diagram">Export…</button>
    <span class="spacer"></span>
    <button id="tb-theme" title="Toggle light / dark rendering">Theme</button>
    <button id="tb-web" title="Open the synced diagram on flowcraft.app">Open on web</button>
  </div>
  <div class="stage"><div id="diagram"></div></div>

  <script nonce="${nonce}" src="${mermaidUri}"></script>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const container = document.getElementById("diagram");
      let renderSeq = 0;

      function initMermaid(theme) {
        try {
          mermaid.initialize({
            startOnLoad: false,
            theme: theme === "dark" ? "dark" : "default",
            securityLevel: "loose",
          });
        } catch (e) { /* ignore */ }
      }

      async function render(code, theme) {
        initMermaid(theme);
        const id = "fc-graph-" + (++renderSeq);
        try {
          const out = await mermaid.render(id, code || "");
          container.innerHTML = out.svg;
          const svgEl = container.querySelector("svg");
          const dims = svgDims(svgEl);
          vscode.postMessage({ command: "rendered", data: { ok: true, width: dims.w, height: dims.h } });
        } catch (e) {
          const msg = (e && e.message) ? e.message : String(e);
          container.innerHTML = "";
          const pre = document.createElement("pre");
          pre.className = "err";
          pre.textContent = "Mermaid error:\\n" + msg;
          container.appendChild(pre);
          vscode.postMessage({ command: "rendered", data: { ok: false, error: msg } });
        }
      }

      function svgDims(svgEl) {
        let w = 0, h = 0;
        if (svgEl) {
          const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
          if (vb && vb.width) { w = vb.width; h = vb.height; }
          if (!w || !h) {
            const r = svgEl.getBoundingClientRect();
            w = r.width || w; h = r.height || h;
          }
        }
        return { w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(h)) };
      }

      function prepareSvg(svgEl, w, h) {
        const clone = svgEl.cloneNode(true);
        clone.setAttribute("width", String(w));
        clone.setAttribute("height", String(h));
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        if (clone.style) { clone.style.maxWidth = "none"; }
        return clone;
      }

      async function rasterize(svgEl, scale, background, mime) {
        const d = svgDims(svgEl);
        const clone = prepareSvg(svgEl, d.w, d.h);
        const str = new XMLSerializer().serializeToString(clone);
        const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(str);
        const img = new Image();
        await new Promise(function (res, rej) {
          img.onload = res;
          img.onerror = function () { rej(new Error("Could not rasterize the SVG.")); };
          img.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(d.w * scale));
        canvas.height = Math.max(1, Math.round(d.h * scale));
        const ctx = canvas.getContext("2d");
        if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const quality = mime === "image/jpeg" ? 0.92 : undefined;
        return { dataUrl: canvas.toDataURL(mime, quality), width: canvas.width, height: canvas.height };
      }

      async function produceExport(requestId, format, scale, background) {
        const svgEl = container.querySelector("svg");
        if (!svgEl) {
          vscode.postMessage({ command: "exportResult", data: { requestId, ok: false, error: "Nothing is rendered to export." } });
          return;
        }
        try {
          if (format === "svg") {
            const d = svgDims(svgEl);
            const clone = prepareSvg(svgEl, d.w, d.h);
            const str = '<?xml version="1.0" encoding="UTF-8"?>\\n' + new XMLSerializer().serializeToString(clone);
            vscode.postMessage({ command: "exportResult", data: { requestId, ok: true, format: "svg", payload: str, width: d.w, height: d.h } });
            return;
          }
          const mime = format === "jpeg" ? "image/jpeg" : "image/png";
          const out = await rasterize(svgEl, scale || 1, background, mime);
          vscode.postMessage({ command: "exportResult", data: { requestId, ok: true, format: format, payload: out.dataUrl, width: out.width, height: out.height } });
        } catch (e) {
          const msg = (e && e.message) ? e.message : String(e);
          vscode.postMessage({ command: "exportResult", data: { requestId, ok: false, error: msg } });
        }
      }

      window.addEventListener("message", function (ev) {
        const m = ev.data || {};
        if (m.command === "render") { render(m.data.code, m.data.theme); }
        else if (m.command === "produceExport") { produceExport(m.data.requestId, m.data.format, m.data.scale, m.data.background); }
      });

      document.getElementById("tb-copy").addEventListener("click", function () { vscode.postMessage({ command: "toolbar", data: { action: "copyCode" } }); });
      document.getElementById("tb-export").addEventListener("click", function () { vscode.postMessage({ command: "toolbar", data: { action: "export" } }); });
      document.getElementById("tb-theme").addEventListener("click", function () { vscode.postMessage({ command: "toolbar", data: { action: "toggleTheme" } }); });
      document.getElementById("tb-web").addEventListener("click", function () { vscode.postMessage({ command: "toolbar", data: { action: "openWeb" } }); });

      vscode.postMessage({ command: "ready" });
    })();
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.failAllPending(new Error("RenderService disposed."));
    this.panel?.dispose();
    this.panel = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
