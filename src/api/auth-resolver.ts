/**
 * AuthResolver - single decision point for outgoing API auth headers.
 *
 * Prefers a signed-in FlowCraft (Supabase) session; falls back to a BYOK
 * provider key when no session is available.
 */

import { AuthService } from "../services/auth-service";
import { APIKeyService } from "../services/api-key-service";
import { Provider } from "../types";

export interface ResolvedAuth {
  /** "signin" → Bearer JWT; "byok" → provider API key. */
  mode: "signin" | "byok";
  headerName: string;
  headerValue: string;
  /** Provider in use for BYOK; undefined when signed-in. */
  provider?: Provider;
}

export class NoCredentialsError extends Error {
  constructor(public readonly attemptedProvider: Provider) {
    super(`No FlowCraft session and no ${attemptedProvider} API key available`);
    this.name = "NoCredentialsError";
  }
}

export interface AuthResolverDeps {
  authService: AuthService;
  apiKeyService: APIKeyService;
  /** Returns the user's BYOK key for the given provider, prompting if needed. */
  ensureProviderKey: (provider: Provider) => Promise<string | undefined>;
  /** The currently configured BYOK provider. */
  getDefaultProvider: () => Provider;
}

export class AuthResolver {
  constructor(private readonly deps: AuthResolverDeps) {}

  async resolve(): Promise<ResolvedAuth> {
    const token = await this.deps.authService.getValidAccessToken();
    if (token) {
      return {
        mode: "signin",
        headerName: "Authorization",
        headerValue: `Bearer ${token}`,
      };
    }

    return this.resolveByok();
  }

  /**
   * BYOK-only resolution. Diagram generation must ALWAYS authenticate with the
   * user's own provider key (`X-api-key`), regardless of whether they are
   * signed in to FlowCraft. If we let a signed-in user's generation switch to a
   * Bearer JWT, the API would generate on FlowCraft's server keys — silently
   * re-introducing the per-generation cost the BYOK-only model removed.
   *
   * Sign-in / JWT (via `resolve()`) is therefore reserved for premium account
   * endpoints (entitlement, cloud sync), never for generation.
   */
  async resolveByok(): Promise<ResolvedAuth> {
    const provider = this.deps.getDefaultProvider();
    const key = await this.deps.ensureProviderKey(provider);
    if (!key) {
      throw new NoCredentialsError(provider);
    }
    return {
      mode: "byok",
      headerName: "X-api-key",
      headerValue: key,
      provider,
    };
  }
}
