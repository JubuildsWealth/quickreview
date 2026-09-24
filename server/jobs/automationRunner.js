const { runReviewFollowups } = require('./reviewFollowup');
const { runInvoiceRecovery } = require('./InvoiceRecovery');
const { runEstimateFollowups } = require('./estimateFollowup');

async function runAutomations() {
  console.log('========================================');
  console.log('[Arova Automations] Starting automation run...');
  console.log('========================================');

  const results = {
    reviewFollowup: null,
    invoiceRecovery: null,
    estimateFollowup: null,
  };

  // -------------------------------------------------------------
  // Review Follow-Up
  // -------------------------------------------------------------
  try {
    results.reviewFollowup = await runReviewFollowups();
  } catch (error) {
    console.error(
      '[Arova Automations] Review Follow-Up failed:',
      error.message
    );
    results.reviewFollowup = { error: error.message };
  }

  // -------------------------------------------------------------
  // Invoice Recovery
  // -------------------------------------------------------------
  try {
    results.invoiceRecovery = await runInvoiceRecovery();
  } catch (error) {
    console.error(
      '[Arova Automations] Invoice Recovery failed:',
      error.message
    );
    results.invoiceRecovery = { error: error.message };
  }

  // -------------------------------------------------------------
  // Estimate Follow-Up
  // -------------------------------------------------------------
  try {
    results.estimateFollowup = await runEstimateFollowups();
  } catch (error) {
    console.error(
      '[Arova Automations] Estimate Follow-Up failed:',
      error.message
    );
    results.estimateFollowup = { error: error.message };
  }

  console.log('========================================');
  console.log('[Arova Automations] Run complete.');
  console.log('[Arova Automations] Results:', results);
  console.log('========================================');

  return results;
}

module.exports = { runAutomations };

if (require.main === module) {
  runAutomations()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Arova Automations] Fatal error:', error);
      process.exit(1);
    });
}
