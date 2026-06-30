import { createJobId, emptySalary, emptyVisaSignals } from './types.js';

export {
  JobSourceProvider,
  JobSourceAdapter,
  validateBoardTokenTarget,
  resolveBoardToken,
} from './providers/providerContract.js';

export function inferWorkMode(location = '', text = '') {
  const combined = `${location} ${text}`.toLowerCase();
  if (combined.includes('remote')) return 'remote';
  if (combined.includes('hybrid')) return 'hybrid';
  return combined.includes('onsite') || combined.includes('on-site') ? 'onsite' : '';
}

export function buildNormalizedJob({
  source,
  atsType,
  company,
  title,
  location = '',
  workMode = '',
  employmentType = 'full_time',
  applyUrl = '',
  description = '',
  postedDate = null,
  visaFit = 'unknown',
  score = 0,
  experienceLevel = '',
  rawData = {},
  dataSource = 'live',
}) {
  const wm = workMode || inferWorkMode(location, description);
  return {
    id: createJobId(source, company, title, applyUrl),
    source,
    atsType: atsType || source,
    company,
    title,
    location,
    workMode: wm,
    employmentType,
    salary: emptySalary(),
    description,
    applyUrl,
    postedDate,
    visaSignals: { ...emptyVisaSignals(), fit: visaFit },
    rawData,
    score,
    experienceLevel,
    autoApplyEligible: score >= 65 && Boolean(applyUrl),
    dataSource,
  };
}
