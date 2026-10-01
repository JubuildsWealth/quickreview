// server/lib/recoveryEngine.js

/**
 * Arova Recovery Engine — V1
 *
 * Converts raw revenue opportunities into consistent recovery decisions.
 *
 * This file does NOT:
 * - query the database
 * - send messages
 * - mutate records
 * - call external services
 *
 * It only evaluates signals and returns:
 * - priority
 * - priority_rank
 * - reason
 * - recommended_action
 * - action_label
 * - needs_human
 * - handling_mode
 *
 * Keeping this logic pure makes it predictable, testable, and safe to
 * reuse as Arova adds more recovery sources.
 */

const PRIORITY_RANKS = {
  low: 1,
  medium: 2,
  high: 3,
};

function safeNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return number;
}

function normalizeDays(value) {
  return Math.max(0, Math.floor(safeNumber(value)));
}

function normalizeReminderCount(value) {
  return Math.max(0, Math.floor(safeNumber(value)));
}

function normalizeAmount(value) {
  return Math.max(0, Math.floor(safeNumber(value)));
}

function makeDecision({
  priority,
  reason,
  recommendedAction,
  actionLabel,
  needsHuman,
  handlingMode,
}) {
  return {
    priority,
    priority_rank: PRIORITY_RANKS[priority] || PRIORITY_RANKS.low,
    reason,
    recommended_action: recommendedAction,
    action_label: actionLabel,
    needs_human: needsHuman,
    handling_mode: handlingMode,
  };
}

/**
 * Human-attention reasons currently written by the invoice and estimate
 * automation jobs.
 *
 * These are stronger signals than age alone.
 */
function evaluateHumanAttention({
  attentionReason,
  amountCents,
}) {
  if (attentionReason === 'customer_replied') {
    return makeDecision({
      priority: 'high',
      reason: 'Customer replied after Arova follow-up',
      recommendedAction: 'respond_to_customer',
      actionLabel: 'Respond',
      needsHuman: true,
      handlingMode: 'human',
    });
  }

  if (attentionReason === 'followup_limit_reached') {
    return makeDecision({
      priority: 'high',
      reason: 'Automated follow-up sequence reached its limit',
      recommendedAction: 'call_customer',
      actionLabel: 'Call customer',
      needsHuman: true,
      handlingMode: 'human',
    });
  }

  // Fail safely if a future attention reason is added by an automation
  // before the Recovery Engine learns its exact meaning.
  return makeDecision({
    priority: amountCents >= 100000 ? 'high' : 'medium',
    reason: 'Arova handed this opportunity off for review',
    recommendedAction: 'review_opportunity',
    actionLabel: 'Review',
    needsHuman: true,
    handlingMode: 'human',
  });
}

/**
 * Evaluate an open invoice or estimate.
 *
 * Strong signals are evaluated before weaker age-based signals.
 */
function evaluateRevenueOpportunity(input = {}) {
  const type = input.type === 'estimate' ? 'estimate' : 'invoice';

  const amountCents = normalizeAmount(input.amount_cents);
  const daysSinceActivity = normalizeDays(input.days_since_activity);
  const reminderCount = normalizeReminderCount(input.reminder_count);

  const needsHumanAttention = input.needs_human_attention === true;
  const attentionReason = input.attention_reason || null;

  // -------------------------------------------------------------
  // SIGNAL 1: Automation has explicitly handed the opportunity off.
  // This outranks age, amount, and reminder count.
  // -------------------------------------------------------------
  if (needsHumanAttention) {
    return evaluateHumanAttention({
      attentionReason,
      amountCents,
    });
  }

  // -------------------------------------------------------------
  // SIGNAL 2: Multiple attempts + long silence.
  //
  // This is intentionally defensive even though the automation jobs
  // should normally set needs_human_attention when their cap is hit.
  // -------------------------------------------------------------
  if (reminderCount >= 2 && daysSinceActivity >= 7) {
    return makeDecision({
      priority: 'high',
      reason: `${reminderCount} follow-ups sent · ${daysSinceActivity} days without activity`,
      recommendedAction: 'call_customer',
      actionLabel: 'Call customer',
      needsHuman: true,
      handlingMode: 'human',
    });
  }

  // -------------------------------------------------------------
  // SIGNAL 3: High-value opportunity going cold.
  //
  // $1,000+ and 3+ days without activity deserves visibility,
  // even if automation has not exhausted its sequence.
  // -------------------------------------------------------------
  if (amountCents >= 100000 && daysSinceActivity >= 3) {
    return makeDecision({
      priority: 'high',
      reason: `${formatOpportunityType(type)} worth ${formatMoneyForReason(
        amountCents
      )} has been quiet for ${daysSinceActivity} days`,
      recommendedAction:
        reminderCount === 0 ? 'send_follow_up' : 'monitor_follow_up',
      actionLabel:
        reminderCount === 0 ? 'Send reminder' : 'Monitor',
      needsHuman: reminderCount === 0,
      handlingMode: reminderCount === 0 ? 'human' : 'arova',
    });
  }

  // -------------------------------------------------------------
  // SIGNAL 4: Aging opportunity with no attempt yet.
  // -------------------------------------------------------------
  if (reminderCount === 0 && daysSinceActivity >= 3) {
    return makeDecision({
      priority: 'medium',
      reason: `${daysSinceActivity} days open · no follow-up sent`,
      recommendedAction: 'send_follow_up',
      actionLabel: 'Send reminder',
      needsHuman: true,
      handlingMode: 'human',
    });
  }

  // -------------------------------------------------------------
  // SIGNAL 5: Arova recently followed up.
  // Give the customer time instead of creating unnecessary work.
  // -------------------------------------------------------------
  if (reminderCount > 0 && daysSinceActivity < 3) {
    return makeDecision({
      priority: 'low',
      reason:
        daysSinceActivity === 0
          ? 'Recently followed up · waiting for reply'
          : `${daysSinceActivity} ${
              daysSinceActivity === 1 ? 'day' : 'days'
            } since follow-up · waiting for reply`,
      recommendedAction: 'wait_for_reply',
      actionLabel: 'Wait for reply',
      needsHuman: false,
      handlingMode: 'arova',
    });
  }

  // -------------------------------------------------------------
  // SIGNAL 6: Follow-up exists, but enough time has passed that the
  // opportunity deserves visibility without forcing intervention yet.
  // -------------------------------------------------------------
  if (reminderCount > 0 && daysSinceActivity >= 3) {
    return makeDecision({
      priority: 'medium',
      reason: `${daysSinceActivity} days since last follow-up · ${reminderCount} ${
        reminderCount === 1 ? 'attempt' : 'attempts'
      } sent`,
      recommendedAction: 'monitor_follow_up',
      actionLabel: 'Monitor',
      needsHuman: false,
      handlingMode: 'arova',
    });
  }

  // -------------------------------------------------------------
  // SIGNAL 7: Brand-new opportunity.
  // -------------------------------------------------------------
  return makeDecision({
    priority: 'low',
    reason:
      daysSinceActivity === 0
        ? 'Recently opened'
        : `${daysSinceActivity} day open`,
    recommendedAction: 'monitor',
    actionLabel: 'Monitor',
    needsHuman: false,
    handlingMode: 'arova',
  });
}

function formatOpportunityType(type) {
  return type === 'estimate' ? 'Estimate' : 'Invoice';
}

/**
 * Only used to produce concise human-readable reasons.
 * The underlying amount remains integer cents everywhere else.
 */
function formatMoneyForReason(cents) {
  const dollars = normalizeAmount(cents) / 100;

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars);
}

/**
 * Recovery Queue sorting.
 *
 * V1 order:
 * 1. Human-action items before automation-owned items
 * 2. Higher priority
 * 3. Larger dollar value
 * 4. Older activity
 *
 * This deliberately avoids pretending we have a machine-learning
 * recovery probability before Arova has enough outcome data.
 */
function sortRecoveryOpportunities(items = []) {
  return [...items].sort((a, b) => {
    if (a.needs_human !== b.needs_human) {
      return a.needs_human ? -1 : 1;
    }

    if ((b.priority_rank || 0) !== (a.priority_rank || 0)) {
      return (b.priority_rank || 0) - (a.priority_rank || 0);
    }

    if ((b.amount_cents || 0) !== (a.amount_cents || 0)) {
      return (b.amount_cents || 0) - (a.amount_cents || 0);
    }

    const aTime = a.last_activity_at
      ? new Date(a.last_activity_at).getTime()
      : Date.now();

    const bTime = b.last_activity_at
      ? new Date(b.last_activity_at).getTime()
      : Date.now();

    return aTime - bTime;
  });
}

module.exports = {
  evaluateRevenueOpportunity,
  sortRecoveryOpportunities,
};
