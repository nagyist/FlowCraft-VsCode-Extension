/**
 * CloudSyncService — premium cloud history sync for the VS Code extension.
 *
 * When the user is signed in AND subscribed (entitled to `cloudSync`), every
 * locally-generated diagram is mirrored into their FlowCraft account so it shows
 * up on the web dashboard and on their other machines. This is purely an
 * account-level convenience layer: generation itself stays free + BYOK and is
 * completely independent of this service.
 *
 * Design:
 * - Auto-sync is SILENT. It listens on `StateManager.onDidAddDiagram` and only
 *   uploads when signed in + entitled + the `cloudSyncEnabled` setting is on.
 *   It never shows the upgrade modal on the generation path — a non-subscriber
 *   generating a diagram should not be nagged.
 * - The explicit "Sync now" command DOES gate via `requirePremium`, so a
 *   non-subscriber who actively asks to sync gets the upsell.
 * - Idempotency: the local diagram `id` is sent as `client_diagram_id`; the
 *   server upserts on `(user_id, client_diagram_id)`, so re-syncing never
 *   duplicates. The returned `remoteId` is stored in the diagram's metadata.
 */

import * as vscode from "vscode";
import { FlowCraftClient } from "../api/flowcraft-client";
import { AuthService } from "./auth-service";
import { EntitlementService } from "./entitlement-service";
import { StateManager } from "../state/state-manager";
import { Diagram, DiagramType, DiagramCategory } from "../types";
import { CloudDiagram } from "../api/types";
import { requirePremium } from "./premium-gate";
import { TelemetryService } from "./telemetry-service";
import { getLogger } from "../utils/logger";

export const FLOWCRAFT_DIAGRAM_WEB_URL = "https://flowcraft.app/vscode";

export class CloudSyncService {
  private readonly disposables: vscode.Disposable[] = [];
  /** Local diagram ids currently being uploaded, to avoid double-sends. */
  private readonly inflight = new Set<string>();

  constructor(
    private readonly apiClient: FlowCraftClient,
    private readonly authService: AuthService,
    private readonly entitlementService: EntitlementService,
    private readonly stateManager: StateManager,
    private readonly telemetry?: TelemetryService
  ) {
    // Auto-sync each newly added diagram (silent; no upgrade prompt).
    this.disposables.push(
      this.stateManager.onDidAddDiagram((diagram) => {
        void this.autoSync(diagram);
      })
    );
  }

  /** True if auto-sync is allowed right now (setting on + signed in + entitled). */
  private async canAutoSync(): Promise<boolean> {
    if (this.stateManager.getSetting("cloudSyncEnabled") === false) {
      return false;
    }
    if (!this.authService.isSignedIn()) {
      return false;
    }
    return this.entitlementService.has("cloudSync");
  }

  /** Silently mirror one diagram to the cloud if eligible and not already synced. */
  private async autoSync(diagram: Diagram): Promise<void> {
    if (diagram.metadata?.remoteId) {
      return; // already synced (e.g. a diagram we just pulled down)
    }
    if (!(await this.canAutoSync())) {
      return;
    }
    await this.push(diagram);
  }

  /** Upload a single diagram. Returns the remote id, or null on failure/skip. */
  private async push(diagram: Diagram): Promise<string | null> {
    if (this.inflight.has(diagram.id)) {
      return null;
    }
    const token = await this.authService.getValidAccessToken();
    if (!token) {
      return null;
    }

    this.inflight.add(diagram.id);
    try {
      const res = await this.apiClient.syncDiagram(token, {
        client_diagram_id: diagram.id,
        title: diagram.title || "Untitled diagram",
        description: diagram.description || "",
        type: String(diagram.type),
        content: diagram.content || "",
        is_public: diagram.isPublic,
      });

      // Record the server id so the tree can badge "Synced" and "Open on web"
      // resolves, and so we never re-upload this diagram.
      this.stateManager.updateDiagram(diagram.id, {
        metadata: {
          ...(diagram.metadata || {}),
          remoteId: res.remote_id,
          syncedAt: new Date().toISOString(),
        },
      });
      return res.remote_id;
    } catch (err) {
      getLogger().error("CloudSyncService: failed to sync diagram", err);
      return null;
    } finally {
      this.inflight.delete(diagram.id);
    }
  }

  /**
   * Explicit "Sync now": push every unsynced local diagram, then pull the
   * cloud history and merge anything missing locally. Gated by `requirePremium`
   * so non-subscribers see the upgrade modal.
   */
  async syncNow(): Promise<void> {
    const entitled = await requirePremium(
      "cloudSync",
      {
        entitlementService: this.entitlementService,
        authService: this.authService,
        telemetry: this.telemetry,
      },
      { featureLabel: "Cloud sync" }
    );
    if (!entitled) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "FlowCraft: syncing diagrams…",
      },
      async () => {
        const token = await this.authService.getValidAccessToken();
        if (!token) {
          vscode.window.showErrorMessage("FlowCraft: please sign in to sync.");
          return;
        }

        // 1. Push unsynced local diagrams.
        const local = this.stateManager.getAllDiagrams();
        let pushed = 0;
        for (const d of local) {
          if (!d.metadata?.remoteId) {
            const remoteId = await this.push(d);
            if (remoteId) {
              pushed++;
            }
          }
        }

        // 2. Pull the cloud history and merge anything we don't have locally.
        let pulled = 0;
        try {
          const remote = await this.apiClient.getMyDiagrams(token, 200, 0);
          pulled = this.mergeRemote(remote);
        } catch (err) {
          getLogger().error("CloudSyncService: failed to pull diagrams", err);
        }

        vscode.window.showInformationMessage(
          `FlowCraft sync complete — ${pushed} uploaded, ${pulled} downloaded.`
        );
      }
    );
  }

  /** Merge pulled cloud diagrams into the local store. Returns the count added. */
  private mergeRemote(remote: CloudDiagram[]): number {
    const existing = new Set(this.stateManager.getAllDiagrams().map((d) => d.id));
    let added = 0;
    for (const r of remote) {
      // Prefer the original client id so a diagram synced from this machine
      // dedupes against its local copy; fall back to the remote id.
      const localId = r.client_diagram_id || `remote_${r.remote_id}`;
      if (existing.has(localId)) {
        continue;
      }
      const now = new Date();
      const diagram: Diagram = {
        id: localId,
        title: r.title || "Untitled diagram",
        description: r.description || "",
        type: (r.type as DiagramType) ?? DiagramType.Flowchart,
        category: this.categoryForType(r.type),
        content: r.content || "",
        isPublic: !!r.is_public,
        createdAt: r.created_at ? new Date(r.created_at) : now,
        updatedAt: now,
        tokensUsed: 0,
        metadata: { remoteId: r.remote_id, syncedAt: now.toISOString() },
      };
      this.stateManager.addDiagram(diagram);
      existing.add(localId);
      added++;
    }
    return added;
  }

  private categoryForType(type: string): DiagramCategory {
    const t = (type || "").toLowerCase();
    if (t.includes("image") || t.includes("illustration")) {
      return DiagramCategory.Image;
    }
    if (t.includes("infographic")) {
      return DiagramCategory.SVG;
    }
    return DiagramCategory.Mermaid;
  }

  /** Web URL for a synced diagram, or null if it hasn't been synced. */
  webUrlFor(diagram: Diagram): string | null {
    const remoteId = diagram.metadata?.remoteId;
    return remoteId ? `${FLOWCRAFT_DIAGRAM_WEB_URL}/${remoteId}` : null;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
