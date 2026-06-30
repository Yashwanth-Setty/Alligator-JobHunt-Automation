/**
 * Build scoring inputs from parsed resume_profiles data.
 */

import { getActiveResume } from './resumeService.js';
import { getDb } from '../db/database.js';
import { resolveScoringSkills } from '../sources/matchScore.js';

function getPreferredLocationFromSettings() {
  const row = getDb().prepare("SELECT value FROM user_settings WHERE key = 'preferred_locations'").get();
  return row?.value || '';
}

function parseProfileJson(row) {
  if (!row?.parsed_profile) return {};
  try {
    return JSON.parse(row.parsed_profile);
  } catch {
    return {};
  }
}

/**
 * @param {string} [filterKeywords]
 * @param {string} [filterLocation]
 */
export function getResumeScoringContext(filterKeywords = '', filterLocation = '') {
  const row = getActiveResume();
  const profile = row ? parseProfileJson(row) : {};
  const parseSucceeded = row?.parse_status === 'success';
  const resumeSkills = Array.isArray(profile.skills) ? profile.skills : [];

  const { skills, skillSource } = resolveScoringSkills({
    resumeSkills,
    filterKeywords,
    parseSucceeded,
  });

  const preferredLocation =
    (filterLocation || '').trim() ||
    (profile.location || '').trim() ||
    getPreferredLocationFromSettings().trim() ||
    '';

  return {
    skills,
    skillSource,
    parseStatus: row?.parse_status || 'none',
    resumeSkills,
    preferredLocation,
    hasResume: Boolean(row),
    parseSucceeded,
  };
}
