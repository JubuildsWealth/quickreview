/**
 * Normalize a phone number to E.164 format for US numbers.
 *
 * Handles all these inputs and returns the same output:
 *   "2097467709"       -> "+12097467709"
 *   "12097467709"      -> "+12097467709"
 *   "+12097467709"     -> "+12097467709"
 *   "(209) 746-7709"   -> "+12097467709"
 *   "209-746-7709"     -> "+12097467709"
 *   "209.746.7709"     -> "+12097467709"
 *   " +1 209 746 7709" -> "+12097467709"
 *
 * Returns null for anything that isn't a valid US number.
 *
 * Rules:
 *   - Strip everything that isn't a digit or a leading +
 *   - 10 digits: assume US, prepend +1
 *   - 11 digits starting with 1: prepend +
 *   - Already E.164 (+ then 11+ digits): return as-is if valid
 *   - Anything else: null
 */
function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Strip whitespace and non-digit characters (keep leading + for detection)
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 10) {
    // US number without country code
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    // US number with country code, may or may not have had +
    return `+${digits}`;
  }

  if (hasPlus && digits.length >= 11 && digits.length <= 15) {
    // Already E.164-ish (could be international)
    return `+${digits}`;
  }

  // Anything else is invalid
  return null;
}

module.exports = { normalizePhone };
