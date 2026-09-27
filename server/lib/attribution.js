// server/lib/attribution.js
//
// Shared attribution rules for Arova recovery events.
//
// Every recovery_events insert (invoice paid, estimate won, and any
// future channel) MUST run through the checks in this file. That way
// the dashboard number stays defensible: one definition of "Arova
// recovered this", enforced in one place.
//
// Current rules:
//   1. At least one Arova reminder must have gone out.
//   2. The last reminder must have been within ATTRIBUTION_WINDOW_DAYS
//      of the recovery event. Old reminders don't get credit for
//      payments that landed months later.
//   3. Claimed recovery amount is capped relative to the source
//      amount, to protect against typos and inflated numbers.
//      Applies to estimates (where the owner enters revenue_cents);
//      for invoices the amount is fixed, so the cap is a no-op there.

const ATTRIBUTION_WINDOW_DAYS = 30;
const ATTRIBUTION_WINDOW_MS = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// Revenue cap for estimate-won events.
// A claimed recovery must be <= max(REVENUE_CAP_MULTIPLIER * reference,
// REVENUE_CAP_FLOOR_CENTS), and always <= HARD_MAX_RECOVERY_CENTS.
const REVENUE_CAP_MULTIPLIER = 2;
const REVENUE_CAP_FLOOR_CENTS = 500_000;   // $5,000
const HARD_MAX_RECOVERY_CENTS = 10_000_000; // $100,000

/**
 * Was the last reminder sent recently enough to plausibly have
 * caused this recovery?
 *
 * @param {string|null} lastRemindedAt - ISO timestamp or null
 * @param {Date} [now] - injectable for tests
 * @returns {boolean}
 */
function isWithinAttributionWindow(lastRemindedAt, now = new Date()) {
  if (!lastRemindedAt) return false;

  const reminded = new Date(lastRemindedAt).getTime();
  if (Number.isNaN(reminded)) return false;

  return (now.getTime() - reminded) <= ATTRIBUTION_WINDOW_MS;
}

/**
 * Decide whether an event qualifies as Arova-attributed recovery.
 *
 * @param {object} params
 * @param {number} params.reminderCount
 * @param {string|null} params.lastRemindedAt
 * @param {Date} [params.now]
 * @returns {boolean}
 */
function qualifiesForRecovery({ reminderCount, lastRemindedAt, now }) {
  if (!reminderCount || reminderCount <= 0) return false;
  return isWithinAttributionWindow(lastRemindedAt, now);
}

/**
 * Validate a claimed recovery amount against a reference (typically
 * the original estimate amount). Rejects typos and abuse without
 * silently clamping — a rejected value must be corrected by the
 * caller, never quietly changed.
 *
 * @param {number} claimedCents
 * @param {number} referenceCents
 * @returns {{ ok: true, amountCents: number }
 *          | { ok: false, error: string, maxAllowedCents: number }}
 */
function capRecoveryAmount(claimedCents, referenceCents) {
  if (!Number.isFinite(claimedCents) || claimedCents <= 0) {
    return {
      ok: false,
      error: 'Recovery amount must be a positive number.',
      maxAllowedCents: 0,
    };
  }

  const ref = Number.isFinite(referenceCents) && referenceCents > 0
    ? referenceCents
    : 0;

  const softCap = Math.max(
    ref * REVENUE_CAP_MULTIPLIER,
    REVENUE_CAP_FLOOR_CENTS,
  );

  const maxAllowed = Math.min(softCap, HARD_MAX_RECOVERY_CENTS);

  if (claimedCents > maxAllowed) {
    const maxDollars = (maxAllowed / 100).toFixed(2);
    return {
      ok: false,
      error:
        `Recovered revenue can't exceed $${maxDollars} for this ` +
        `record. Enter a value up to $${maxDollars}, or contact ` +
        `support for exceptions.`,
      maxAllowedCents: maxAllowed,
    };
  }

  return { ok: true, amountCents: claimedCents };
}

module.exports = {
  ATTRIBUTION_WINDOW_DAYS,
  REVENUE_CAP_MULTIPLIER,
  REVENUE_CAP_FLOOR_CENTS,
  HARD_MAX_RECOVERY_CENTS,
  isWithinAttributionWindow,
  qualifiesForRecovery,
  capRecoveryAmount,
};
