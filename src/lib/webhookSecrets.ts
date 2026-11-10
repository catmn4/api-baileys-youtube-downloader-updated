/**
 * Rotation grace resolver.
 *
 * During a grace window the PREVIOUS secret stays primary so receivers that
 * have not been updated yet keep working. The new secret travels as secondary
 * (`x-webhook-secret-new` / `x-webhook-signature-new`). Once the window ends,
 * the new secret becomes primary. Nothing rotates or expires without an
 * explicit rotation.
 */
export interface WebhookSecretState {
  webhookSecret?: string;
  webhookSecretPrevious?: string;
  webhookSecretPreviousExpiresAt?: number;
}

export interface ActiveWebhookSecrets {
  /** Secret used for the standard signature and token headers. */
  primary: string;
  /** New secret offered in the `-new` headers during a grace window. */
  secondary?: string;
  /** Epoch ms when the previous secret stops being accepted. */
  previousValidUntil?: number;
}

export function activeWebhookSecrets(
  state: WebhookSecretState,
  now = Date.now(),
): ActiveWebhookSecrets {
  const current = state.webhookSecret || "";
  const previous = state.webhookSecretPrevious || "";
  const until = Number(state.webhookSecretPreviousExpiresAt || 0);

  if (previous && until > now) {
    return {
      primary: previous,
      secondary: current || undefined,
      previousValidUntil: until,
    };
  }

  return { primary: current };
}
