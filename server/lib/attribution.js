// server/lib/attribution.js
//
// Shared attribution rules for Arova recovery events.
//
// Attribution levels:
//
//   confirmed
//     Arova sent a qualifying reminder, the customer replied to that
//     exact invoice/estimate, and the recovery happened inside the
//     attribution window.
//
//   influenced
//     Arova sent a qualifying reminder and the recovery happened
//     inside the attribution window, but there is no linked customer
//     reply proving direct engagement.
//
//   none
//     No qualifying reminder or the recovery happened outside the
//     attribution window.
//
// IMPORTANT:
// "none" should NOT be written to recovery_events. It means Arova
// does not have enough evidence to claim involvement.

const ATTRIBUTION_WINDOW_DAYS = 30;
const ATTRIBUTION_WINDOW_MS =
  ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// Revenue cap for estimate-won events.
const REVENUE_CAP_MULTIPLIER = 2;
const REVENUE_CAP_FLOOR_CENTS = 500_000;    // $5,000
const HARD_MAX_RECOVERY_CENTS = 10_000_000; // $100,000

/**
 * Was the last reminder sent recently enough to plausibly have
 * contributed to this recovery?
 *
 * Future timestamps are rejected rather than treated as valid.
 *
 * @param {string|null} lastRemindedAt
 * @param {Date} [now]
 * @returns {boolean}
 */
function isWithinAttributionWindow(lastRemindedAt, now = new Date()) {
  if (!lastRemindedAt) return false;

  const remindedMs = new Date(lastRemindedAt).getTime();
  const nowMs = now.getTime();

  if (Number.isNaN(remindedMs) || Number.isNaN(nowMs)) {
    return false;
  }

  const elapsedMs = nowMs - remindedMs;

  return (
    elapsedMs >= 0 &&
    elapsedMs <= ATTRIBUTION_WINDOW_MS
  );
}

/**
 * Classify Arova's involvement in a recovery.
 *
 * @param {object} params
 * @param {number} params.reminderCount
 * @param {string|null} params.lastRemindedAt
 * @param {boolean} [params.hasLinkedReply=false]
 * @param {Date} [params.now]
 * @returns {'confirmed'|'influenced'|'none'}
 */
function getAttributionLevel({
  reminderCount,
  lastRemindedAt,
  hasLinkedReply = false,
  now,
}) {
  if (!reminderCount || reminderCount <= 0) {
    return 'none';
  }

  if (!isWithinAttributionWindow(lastRemindedAt, now)) {
    return 'none';
  }

  if (hasLinkedReply === true) {
    return 'confirmed';
  }

  return 'influenced';
}

/**
 * Backwards-compatible boolean helper.
 *
 * Existing callers can continue using qualifiesForRecovery while
 * routes are migrated to getAttributionLevel().
 *
 * @param {object} params
 * @param {number} params.reminderCount
 * @param {string|null} params.lastRemindedAt
 * @param {Date} [params.now]
 * @returns {boolean}
 */
function qualifiesForRecovery({
  reminderCount,
  lastRemindedAt,
  now,
}) {
  return (
    getAttributionLevel({
      reminderCount,
      lastRemindedAt,
      hasLinkedReply: false,
      now,
    }) !== 'none'
  );
}

/**
 * Validate a claimed recovery amount against a reference amount.
 *
 * Rejects suspicious values rather than silently clamping them.
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

  const ref =
    Number.isFinite(referenceCents) && referenceCents > 0
      ? referenceCents
      : 0;

  const softCap = Math.max(
    ref * REVENUE_CAP_MULTIPLIER,
    REVENUE_CAP_FLOOR_CENTS
  );

  const maxAllowed = Math.min(
    softCap,
    HARD_MAX_RECOVERY_CENTS
  );

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

  return {
    ok: true,
    amountCents: claimedCents,
  };
}

module.exports = {
  ATTRIBUTION_WINDOW_DAYS,
  REVENUE_CAP_MULTIPLIER,
  REVENUE_CAP_FLOOR_CENTS,
  HARD_MAX_RECOVERY_CENTS,
  isWithinAttributionWindow,
  getAttributionLevel,
  qualifiesForRecovery,
  capRecoveryAmount,
};
