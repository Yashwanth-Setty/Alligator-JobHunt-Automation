/**
 * Visa signal detection from job description text.
 * Returns visaFit: positive | negative | unknown
 */

const POSITIVE_PATTERNS = [
  /\bvisa sponsorship\b/i,
  /\bwill sponsor\b/i,
  /\bsponsorship available\b/i,
  /\bh-?1b\b/i,
  /\bopt\b/i,
  /\bcpt\b/i,
  /\binternational students?\b/i,
  /\binternational candidates?\b/i,
  /\bwork authorization.*sponsor/i,
  /\bsponsor.*work authorization/i,
  /\beligible for sponsorship\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bno sponsorship\b/i,
  /\bnot sponsor\b/i,
  /\bunable to sponsor\b/i,
  /\bwithout sponsorship\b/i,
  /\bmust be authorized to work\b/i,
  /\bauthorized to work in (the )?(us|united states)\b/i,
  /\bwithout (the )?need for sponsorship\b/i,
  /\bus citizen(s)? only\b/i,
  /\bus citizenship required\b/i,
  /\bsecurity clearance required\b/i,
  /\bactive (secret|top secret) clearance\b/i,
  /\brequires? (a )?security clearance\b/i,
  /\bno visa sponsorship\b/i,
];

/**
 * @param {string} text
 * @returns {{ fit: 'positive'|'negative'|'unknown', sponsorshipMentioned: boolean, cptMentioned: boolean, signals: string[] }}
 */
export function detectVisaSignals(text = '') {
  const lower = String(text || '').toLowerCase();
  const signals = [];

  let positive = false;
  let negative = false;

  for (const re of POSITIVE_PATTERNS) {
    if (re.test(lower)) {
      positive = true;
      signals.push(re.source.slice(0, 40));
    }
  }
  for (const re of NEGATIVE_PATTERNS) {
    if (re.test(lower)) {
      negative = true;
      signals.push(`neg:${re.source.slice(0, 30)}`);
    }
  }

  const sponsorshipMentioned = /\bsponsor/i.test(lower);
  const cptMentioned = /\b(cpt|opt|f-?1)\b/i.test(lower);

  let fit = 'unknown';
  if (negative && !positive) fit = 'negative';
  else if (positive && !negative) fit = 'positive';
  else if (positive && negative) fit = 'unknown';
  else if (cptMentioned || sponsorshipMentioned) fit = 'positive';

  return { fit, sponsorshipMentioned, cptMentioned, signals };
}

/** Map legacy visa_fit values to new schema */
export function mapLegacyVisaFit(fit) {
  const v = String(fit || '').toLowerCase();
  if (v === 'positive' || v === 'negative' || v === 'unknown') return v;
  if (v.includes('cpt') || v.includes('sponsor')) return 'positive';
  if (v === 'review') return 'negative';
  return 'unknown';
}
