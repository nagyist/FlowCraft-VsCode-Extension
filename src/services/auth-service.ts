/**
 * Auth Service - manages a signed-in Supabase session in vscode.SecretStorage.
 *
 * Persists access/refresh tokens for the user's FlowCraft (Supabase) account
 * after the OAuth flow completes via the URI handler. Refreshes the access
 * token automatically against Supabase's token endpoint when it is near expiry.
 */

import * as vscode from "vscode";

const KEY_ACCESS_TOKEN = "flowcraft.auth.accessToken";
const KEY_REFRESH_TOKEN = "flowcraft.auth.refreshToken";
const KEY_EXPIRES_AT = "flowcraft.auth.expiresAt";
const KEY_USER_EMAIL = "flowcraft.auth.userEmail";

const REFRESH_LEEWAY_MS = 30_000;

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
  email: string;
}

export interface AuthServiceConfig {
  /** Supabase project URL (e.g. https://abcd.supabase.co). */
  supabaseUrl: string;
  /** Supabase anon key — required by the token-refresh endpoint. */
  supabaseAnonKey: string;
}

export class AuthService {
  private readonly _onDidChangeSession = new vscode.EventEmitter<AuthSession | null>();
  readonly onDidChangeSession = this._onDidChangeSession.event;

  private cached: AuthSession | null | undefined = undefined;
  private inflightRefresh: Promise<string | null> | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly config: AuthServiceConfig
  ) {}

  async storeSession(session: AuthSession): Promise<void> {
    await Promise.all([
      this.context.secrets.store(KEY_ACCESS_TOKEN, session.accessToken),
      this.context.secrets.store(KEY_REFRESH_TOKEN, session.refreshToken),
      this.context.secrets.store(KEY_EXPIRES_AT, String(session.expiresAt)),
      this.context.secrets.store(KEY_USER_EMAIL, session.email),
    ]);
    this.cached = session;
    this._onDidChangeSession.fire(session);
  }

  async getSession(): Promise<AuthSession | null> {
    if (this.cached !== undefined) {
      return this.cached;
    }
    const [accessToken, refreshToken, expiresAtRaw, email] = await Promise.all([
      this.context.secrets.get(KEY_ACCESS_TOKEN),
      this.context.secrets.get(KEY_REFRESH_TOKEN),
      this.context.secrets.get(KEY_EXPIRES_AT),
      this.context.secrets.get(KEY_USER_EMAIL),
    ]);
    if (!accessToken || !refreshToken || !expiresAtRaw) {
      this.cached = null;
      return null;
    }
    this.cached = {
      accessToken,
      refreshToken,
      expiresAt: Number(expiresAtRaw),
      email: email ?? "",
    };
    return this.cached;
  }

  async clearSession(): Promise<void> {
    await Promise.all([
      this.context.secrets.delete(KEY_ACCESS_TOKEN),
      this.context.secrets.delete(KEY_REFRESH_TOKEN),
      this.context.secrets.delete(KEY_EXPIRES_AT),
      this.context.secrets.delete(KEY_USER_EMAIL),
    ]);
    this.cached = null;
    this._onDidChangeSession.fire(null);
  }

  /**
   * Returns a usable access token, refreshing it if it's within the leeway
   * window of expiry. Returns null when there is no session or the refresh
   * fails (in which case the session is cleared).
   */
  async getValidAccessToken(): Promise<string | null> {
    const session = await this.getSession();
    if (!session) return null;

    const nowMs = Date.now();
    const expiresAtMs = session.expiresAt * 1000;
    if (expiresAtMs - nowMs > REFRESH_LEEWAY_MS) {
      return session.accessToken;
    }

    if (!this.inflightRefresh) {
      this.inflightRefresh = this.doRefresh(session.refreshToken).finally(() => {
        this.inflightRefresh = null;
      });
    }
    return this.inflightRefresh;
  }

  private async doRefresh(refreshToken: string): Promise<string | null> {
    try {
      const url = `${this.config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.config.supabaseAnonKey,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        await this.clearSession();
        return null;
      }
      const data: any = await res.json();
      const session = await this.getSession();
      const updated: AuthSession = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
        email: data.user?.email ?? session?.email ?? "",
      };
      await this.storeSession(updated);
      return updated.accessToken;
    } catch (err) {
      console.error("FlowCraft token refresh failed:", err);
      await this.clearSession();
      return null;
    }
  }

  /** Best-effort remote sign-out; ignores errors. */
  async signOutRemote(): Promise<void> {
    const session = await this.getSession();
    if (!session) return;
    try {
      await fetch(`${this.config.supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: this.config.supabaseAnonKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
    } catch {
      // ignore
    }
  }

  isSignedIn(): boolean {
    return this.cached != null;
  }
}
