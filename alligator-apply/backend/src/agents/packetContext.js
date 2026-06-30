/**
 * Shared context for career agent packet generation.
 */

export function buildPacketContext({ job, resumeRow, settings = {} }) {
  let profile = {};
  try {
    profile = JSON.parse(resumeRow?.parsed_profile || '{}');
  } catch {
    profile = {};
  }

  const candidateName =
    profile.name ||
    settings.fullName ||
    settings.profile?.fullName ||
    'Candidate';
  const candidateEmail = profile.email || settings.email || settings.profile?.email || '';
  const candidatePhone = profile.phone || settings.phone || settings.profile?.phone || '';
  const candidateLocation = profile.location || settings.preferredLocations || '';

  return {
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url || job.apply_url,
      description: job.description || '',
      score: job.score ?? 0,
      visaFit: job.visa_fit || job.visa_indicators?.fit || 'unknown',
      matchedSkills: job.required_skills || job.matchedSkills || [],
      missingSkills: job.missing_skills || job.missingSkills || [],
    },
    resume: {
      fileName: resumeRow?.file_name || '',
      extractedText: resumeRow?.extracted_text || '',
      parseStatus: resumeRow?.parse_status || 'none',
      skills: Array.isArray(profile.skills) ? profile.skills : [],
      yearsOfExperience: profile.yearsOfExperience ?? null,
    },
    candidate: {
      name: candidateName,
      email: candidateEmail,
      phone: candidatePhone,
      location: candidateLocation,
      visaStatus: settings.visaStatus || settings.preferences?.visaStatus || 'cpt',
    },
  };
}
