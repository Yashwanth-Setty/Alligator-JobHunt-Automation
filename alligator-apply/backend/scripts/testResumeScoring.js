/**
 * Smoke test: two different resume skill profiles score the same job differently.
 * Run: npm run test:scoring
 */

import { calculateResumeMatchScore, resolveScoringSkills } from '../src/sources/matchScore.js';

const SAMPLE_JOB = {
  title: 'Senior Java Backend Engineer',
  company: 'TechCo',
  location: 'Remote US',
  description:
    'Build microservices with Java, Spring Boot, AWS, and Kubernetes. React experience is a plus. Visa sponsorship available.',
  applyUrl: 'https://example.com/jobs/1',
  experienceLevel: 'senior',
  visaSignals: { fit: 'positive', sponsorshipMentioned: true, cptMentioned: false },
};

const JAVA_RESUME_SKILLS = [
  'Java',
  'Spring Boot',
  'AWS',
  'Kubernetes',
  'Microservices',
  'SQL',
];

const DESIGN_RESUME_SKILLS = [
  'Figma',
  'Sketch',
  'Adobe XD',
  'UI Design',
  'Prototyping',
  'User Research',
];

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function scoreWithSkills(skills, skillSource = 'resume') {
  return calculateResumeMatchScore(SAMPLE_JOB, {
    keywords: skills,
    preferredLocation: 'Remote US',
    skillSource,
  });
}

console.log('── resume-based scoring ──');

const javaScore = scoreWithSkills(JAVA_RESUME_SKILLS);
const designScore = scoreWithSkills(DESIGN_RESUME_SKILLS);

console.log(`  Java resume score:   ${javaScore.score} (matched: ${javaScore.matchedSkills.join(', ')})`);
console.log(`  Design resume score: ${designScore.score} (matched: ${designScore.matchedSkills.join(', ') || 'none'})`);
console.log(`  Java missing:   ${javaScore.missingSkills.slice(0, 4).join(', ') || 'none'}`);
console.log(`  Design missing: ${designScore.missingSkills.slice(0, 4).join(', ') || 'none'}`);

assert(javaScore.score > designScore.score, 'Java resume should score higher than design resume');
assert(javaScore.matchedSkills.length > designScore.matchedSkills.length, 'Java resume should match more skills');
assert(javaScore.missingSkills.length < designScore.missingSkills.length, 'Java resume should have fewer missing skills');
assert(
  javaScore.breakdown.some((r) => r.label === 'Title alignment' && r.detail),
  'breakdown includes title alignment detail'
);
assert(
  javaScore.breakdown.some((r) => r.label === 'Visa signals' && r.detail),
  'breakdown includes visa detail'
);

const { skills: fallbackSkills, skillSource } = resolveScoringSkills({ parseSucceeded: false });
const fallback = scoreWithSkills(fallbackSkills, skillSource);
assert(fallback.skillSource === 'fallback', 'fallback skill source when parse failed');

console.log('\n── summary: all scoring checks passed ──');
