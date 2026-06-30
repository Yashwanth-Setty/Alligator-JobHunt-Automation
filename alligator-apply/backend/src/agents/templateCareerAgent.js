/**
 * Deterministic template-based application packet generation.
 */

const CPT_VISA_SUGGESTION =
  'I am authorized to work in the United States under Full-Time CPT through my university. I may require future employment sponsorship depending on long-term employment status.';

function firstSentence(text = '', max = 220) {
  const trimmed = String(text).replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const slice = trimmed.slice(0, max);
  const period = slice.lastIndexOf('.');
  return period > 80 ? slice.slice(0, period + 1) : slice;
}

function topSkills(context, limit = 5) {
  const fromJob = context.job.matchedSkills || [];
  const fromResume = context.resume.skills || [];
  const merged = [...new Set([...fromJob, ...fromResume].map((s) => String(s).trim()).filter(Boolean))];
  return merged.slice(0, limit);
}

function buildResumeImprovements(context) {
  const missing = context.job.missingSkills || [];
  const suggestions = [];

  if (missing.length) {
    suggestions.push(
      `Address keyword gaps honestly: consider adding projects or bullet points that demonstrate ${missing.slice(0, 5).join(', ')} if you truly have that experience.`
    );
  }

  suggestions.push(
    `Lead with a tailored summary naming ${context.job.title} at ${context.job.company} and your strongest overlap: ${topSkills(context).join(', ') || 'relevant experience'}.`
  );

  if (context.resume.yearsOfExperience != null) {
    suggestions.push(
      `Quantify impact in recent roles (${context.resume.yearsOfExperience}+ years experience) using metrics, scope, and technologies mentioned in the job description.`
    );
  } else {
    suggestions.push('Add quantified outcomes (latency, revenue, users, cost) to your top 3 resume bullets.');
  }

  const excerpt = firstSentence(context.resume.extractedText, 180);
  if (excerpt) {
    suggestions.push(`Reuse proven phrasing from your resume summary: "${excerpt}"`);
  }

  return suggestions;
}

function buildCoverLetter(context) {
  const { candidate, job } = context;
  const skills = topSkills(context).join(', ');
  return [
    `Dear Hiring Team at ${job.company},`,
    '',
    `I am writing to express my interest in the ${job.title} role. My background in ${skills || 'software engineering'} aligns with the requirements outlined in your posting, and I am excited about the opportunity to contribute to ${job.company}.`,
    '',
    firstSentence(context.resume.extractedText, 320) ||
      `I bring hands-on experience building reliable software and collaborating across teams to deliver production-ready solutions.`,
    '',
    `I would welcome the chance to discuss how my experience maps to ${job.title}. Thank you for your consideration.`,
    '',
    'Best regards,',
    candidate.name,
    candidate.email,
  ].join('\n');
}

function buildRecruiterEmail(context) {
  const { candidate, job } = context;
  const subject = `Application — ${job.title} — ${candidate.name}`;
  const body = [
    `Hello ${job.company} Recruiting Team,`,
    '',
    `I recently applied for the ${job.title} position and wanted to introduce myself directly. I am ${candidate.name}, with experience in ${topSkills(context).join(', ') || 'relevant technologies'}.`,
    '',
    `The role is a strong fit based on my background${job.score ? ` (${job.score}% match in my tracker)` : ''}. I would appreciate any update on the hiring timeline.`,
    '',
    'Thank you,',
    candidate.name,
    candidate.email,
    candidate.phone,
  ]
    .filter(Boolean)
    .join('\n');
  return { subject, body };
}

function buildLinkedInMessage(context) {
  const { candidate, job } = context;
  const msg = `Hi — I applied for the ${job.title} role at ${job.company}. My background in ${topSkills(context, 3).join(', ') || 'engineering'} looks like a strong fit. Would welcome connecting. — ${candidate.name}`;
  return msg.length > 300 ? `${msg.slice(0, 297)}...` : msg;
}

function buildFollowUpEmail(context) {
  const { candidate, job } = context;
  const subject = `Following up — ${job.title} application`;
  const body = [
    `Hello ${job.company} Team,`,
    '',
    `I hope you are doing well. I wanted to follow up on my application for ${job.title}, submitted recently. I remain very interested in the opportunity and believe my experience with ${topSkills(context, 4).join(', ') || 'the listed requirements'} would translate well to your team.`,
    '',
    `Please let me know if you need any additional information. Thank you for your time.`,
    '',
    'Best,',
    candidate.name,
    candidate.email,
  ].join('\n');
  return { subject, body };
}

function buildApplicationAnswers(context) {
  const { job, candidate } = context;
  return [
    {
      question: 'Are you legally authorized to work in the US?',
      guidance: 'Confirm against your I-20 CPT dates before submitting.',
      suggestion: CPT_VISA_SUGGESTION,
      requiresConfirmation: true,
    },
    {
      question: 'Will you now or in the future require sponsorship?',
      guidance: 'CPT does not require H-1B sponsorship during authorized CPT employment.',
      suggestion: CPT_VISA_SUGGESTION,
      requiresConfirmation: true,
    },
    {
      question: 'Why are you interested in this role?',
      guidance: 'Personalize with company-specific details before submitting.',
      suggestion: `I am interested in ${job.title} at ${job.company} because it aligns with my experience in ${topSkills(context).join(', ') || 'this domain'} and the team’s technical focus.`,
      requiresConfirmation: false,
    },
    {
      question: 'Describe your relevant experience',
      guidance: 'Only claim skills you can demonstrate in interviews.',
      suggestion:
        firstSentence(context.resume.extractedText, 400) ||
        `Highlight projects using ${topSkills(context).join(', ') || 'technologies from the job description'}.`,
      requiresConfirmation: false,
    },
    {
      question: 'Expected salary',
      guidance: 'Research levels.fyi / Glassdoor for this title and location.',
      suggestion: 'Open to discussion based on role scope, level, and location. [Enter your target range after research.]',
      requiresConfirmation: true,
    },
    {
      question: 'Earliest start date',
      guidance: 'Must align with CPT authorization dates if applicable.',
      suggestion: '[Enter date — typically 2 weeks from offer or aligned with CPT start on I-20.]',
      requiresConfirmation: true,
    },
    {
      question: 'Work authorization status',
      guidance: `Current setting: ${candidate.visaStatus || 'not specified'}.`,
      suggestion: CPT_VISA_SUGGESTION,
      requiresConfirmation: true,
    },
  ];
}

export async function generateTemplatePacket(context) {
  return {
    provider: 'template',
    generatedAt: new Date().toISOString(),
    resumeImprovements: buildResumeImprovements(context),
    coverLetter: buildCoverLetter(context),
    recruiterEmail: buildRecruiterEmail(context),
    linkedInMessage: buildLinkedInMessage(context),
    followUpEmail: buildFollowUpEmail(context),
    applicationAnswers: buildApplicationAnswers(context),
    metadata: {
      jobId: context.job.id,
      jobTitle: context.job.title,
      company: context.job.company,
      matchScore: context.job.score,
      candidateName: context.candidate.name,
      resumeParseStatus: context.resume.parseStatus,
    },
  };
}
