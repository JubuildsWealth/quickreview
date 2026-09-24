const { runReviewFollowups } = require('./reviewFollowup');
const { runInvoiceRecovery } = require('./invoiceRecovery');

async function runAutomations() {
  console.log('========================================');
  console.log('[Arova Automations] Starting automation run...');
  console.log('========================================');

  const results = {
    reviewFollowup: null,
    invoiceRecovery: null,
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

    results.reviewFollowup = {
      error: error.message,
    };
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

    results.invoiceRecovery = {
      error: error.message,
    };
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
