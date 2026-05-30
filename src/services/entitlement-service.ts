/**
 * EntitlementService — resolves the signed-in user's premium entitlement.
 *
 * Entitlement is an ACCOUNT-level concern, completely separate from diagram
 * generation (which always uses the user's own BYOK key). This service is the
 * single source of truth the extension gates premium features on: cloud sync,
 * premium templates, advanced exports.
 *
 * - Returns null when signed out.
 * - Caches for 5 minutes; the cache is invalidated whenever the auth session
 *   changes (sign-in, sign-out, token refresh swap), so flipping a Stripe
 *   subscription is reflected on the next call after re-auth or cache expiry.
 */

import * as vscode from "vscode";
import { FlowCraftClient } from "../api/flowcraft-client";
import { AuthService } from "./auth-service";
import { Entitlement, PremiumFeature } from "../types";
import { getLogger } from "../utils/logger";

const CACHE_TTL_MS = 5 * 60 * 1000;

export class EntitlementService {
  private cached: Entitlement | null | undefined = undefined;
  private cachedAt = 0;
  private inflight: Promise<Entitlement | null> | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<Entitlement | null>();
  /** Fires whenever the resolved entitlement changes (incl. sign-out → null). */
  readonly onDidChange = this._onDidChange.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly apiClient: FlowCraftClient,
    private readonly authService: AuthService
  ) {
    // Any session change can change entitlement (sign in/out, account swap).
    this.disposables.push(
      this.authService.onDidChangeSession(() => {
        this.invalidate();
      })
    );
  }

  /** Drop the cache so the next get() re-fetches. */
  invalidate(): void {
    this.cached = undefined;
    this.cachedAt = 0;
    this.inflight = undefined;
  }

  /**
   * Resolve the current entitlement. Returns null when signed out or when the
   * lookup fails (fail-closed: a network hiccup must never unlock premium).
   */
  async get(forceRefresh = false): Promise<Entitlement | null> {
    const fresh =
      this.cached !== undefined &&
      Date.now() - this.cachedAt < CACHE_TTL_MS;
    if (!forceRefresh && fresh) {
      return this.cached ?? null;
    }

    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = this.fetch().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetch(): Promise<Entitlement | null> {
    const token = await this.authService.getValidAccessToken();
    if (!token) {
      this.set(null);
      return null;
    }

    try {
      const entitlement = await this.apiClient.getEntitlement(token);
      this.set(entitlement);
      return entitlement;
    } catch (err) {
      getLogger().error("EntitlementService: failed to fetch entitlement", err);
      // Fail closed: treat an errored lookup as "not entitled" without
      // poisoning the cache, so a transient failure retries next time.
      this.cached = undefined;
      this.cachedAt = 0;
      return null;
    }
  }

  private set(value: Entitlement | null): void {
    const changed =
      JSON.stringify(this.cached ?? null) !== JSON.stringify(value);
    this.cached = value;
    this.cachedAt = Date.now();
    if (changed) {
      this._onDidChange.fire(value);
    }
  }

  /** True if the user is signed in AND subscribed. */
  async isSubscribed(): Promise<boolean> {
    const e = await this.get();
    return !!e?.subscribed;
  }

  /** True if the user is entitled to a specific premium feature. */
  async has(feature: PremiumFeature): Promise<boolean> {
    const e = await this.get();
    return !!e?.features?.[feature];
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
