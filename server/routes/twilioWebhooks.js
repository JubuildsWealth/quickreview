const express = require('express');
const twilio = require('twilio');
const { supabaseAdmin } = require('../lib/supabase');
const { handleMissedCall } = require('../jobs/missedCallRecovery');

const router = express.Router();

// -------------------------------------------------------------
// Twilio signature validation middleware
//
// Without this, anyone on the internet could POST to these
// endpoints and either forward calls anywhere or trigger fake
// SMS to arbitrary numbers. Not optional.
// -------------------------------------------------------------
function validateTwilioSignature(req, res, next) {
  const twilioSignature = req.headers['x-twilio-signature'];
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Build the full URL Twilio hit. Railway terminates SSL,
  // so req.protocol reports http — force https for validation.
  const url = `https://${req.get('host')}${req.originalUrl}`;

  const isValid = twilio.validateRequest(
    authToken,
    twilioSignature,
    url,
    req.body
  );

  if (!isValid) {
    console.warn(
      '[Twilio Webhook] Signature validation failed for',
      req.originalUrl
    );
    return res.status(403).send('Forbidden');
  }

  next();
}

// -------------------------------------------------------------
// POST /api/twilio/voice-incoming
//
// Twilio hits this the moment a call comes in.
// We respond with TwiML that tells Twilio to dial the
// contractor's real phone.
// -------------------------------------------------------------
router.post('/voice-incoming', validateTwilioSignature, async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  const arovaPhone = req.body.To;       // the Twilio number that was called
  const callerPhone = req.body.From;    // the customer's phone

  console.log(
    `[Voice Incoming] Call from ${callerPhone} to ${arovaPhone}`
  );

  try {
    // SINGLE-TENANT: hardcoded business for now.
    // Later: look up business by arovaPhone -> businesses.twilio_phone_number
    const businessId = process.env.MISSED_CALL_TEST_BUSINESS_ID;

    if (!businessId) {
      console.error(
        '[Voice Incoming] MISSED_CALL_TEST_BUSINESS_ID is not set.'
      );
      twiml.say('Sorry, this number is not currently configured.');
      return res.type('text/xml').send(twiml.toString());
    }

    const { data: business, error } = await supabaseAdmin
      .from('businesses')
      .select('id, name, phone')
      .eq('id', businessId)
      .single();

    if (error || !business) {
      console.error(
        '[Voice Incoming] Could not load business:',
        error?.message
      );
      twiml.say('Sorry, this number is not currently configured.');
      return res.type('text/xml').send(twiml.toString());
    }

    if (!business.phone) {
      console.error(
        `[Voice Incoming] Business ${business.id} has no phone number to forward to.`
      );
      twiml.say('Sorry, no forwarding number is set for this business.');
      return res.type('text/xml').send(twiml.toString());
    }

    // Dial the contractor's real phone with a 20-second timeout.
    // If they don't pick up, the call ends and the status
    // callback below fires with CallStatus=no-answer.
    const dial = twiml.dial({
      timeout: 20,
      callerId: arovaPhone,   // caller sees the Arova number, keeps our branding
      action: `${process.env.PUBLIC_API_URL}/api/twilio/voice-status`,
      method: 'POST',
    });

    dial.number(business.phone);

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('[Voice Incoming] Unexpected error:', error.message);
    twiml.say('Sorry, something went wrong.');
    res.type('text/xml').send(twiml.toString());
  }
});

// -------------------------------------------------------------
// POST /api/twilio/voice-status
//
// Fired by the <Dial> action after the forward attempt ends.
// This is where we decide whether to send the auto-text.
//
// Twilio sends DialCallStatus with values like:
//   'completed'  -> contractor answered, DO NOT text
//   'no-answer'  -> contractor didn't pick up, text the caller
//   'busy'       -> contractor was on another call, text the caller
//   'failed'     -> line issue, text the caller
//   'canceled'   -> caller hung up before ring finished, text the caller
// -------------------------------------------------------------
router.post('/voice-status', validateTwilioSignature, async (req, res) => {
  const callSid = req.body.CallSid;
  const callerPhone = req.body.From;
  const arovaPhone = req.body.To;
  const dialCallStatus = req.body.DialCallStatus;
  const dialCallDuration = parseInt(req.body.DialCallDuration || '0', 10);

  console.log(
    `[Voice Status] CallSid=${callSid} DialCallStatus=${dialCallStatus} ` +
    `Duration=${dialCallDuration}s From=${callerPhone}`
  );

  // Respond immediately so Twilio doesn't retry.
  // Missed-call handling happens async after this.
  const twiml = new twilio.twiml.VoiceResponse();
  res.type('text/xml').send(twiml.toString());

  // Only these statuses count as a missed call for text-back.
  const missedStatuses = ['no-answer', 'busy', 'failed', 'canceled'];
  if (!missedStatuses.includes(dialCallStatus)) {
    console.log(
      `[Voice Status] Not a missed call (status=${dialCallStatus}), no text sent.`
    );
    return;
  }

  // Fire-and-forget the missed-call handler.
  handleMissedCall({
    callSid,
    callerPhone,
    arovaPhone,
    callStatus: dialCallStatus,
    callDurationSec: dialCallDuration,
  }).catch((error) => {
    console.error(
      `[Voice Status] handleMissedCall failed for ${callSid}:`,
      error.message
    );
  });
});

module.exports = router;
