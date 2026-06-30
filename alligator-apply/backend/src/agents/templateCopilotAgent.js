/**
 * Template-based Career Copilot responses.
 */

const ACTION_LABELS = {
  explain_match: 'Explain match score',
  suggest_resume_changes: 'Suggest resume changes',
  prepare_interview: 'Prepare for interview',
  generate_recruiter_message: 'Generate recruiter message',
  explain_rejection: 'Explain rejection',
  recommend_next_action: 'Recommend next action',
};

function jobRef(context) {
  const job = context.selectedJob;
  if (job) return `${job.title} at ${job.company}`;
  const top = context.recentJobs[0];
  if (top) return `${top.title} at ${top.company}`;
  return 'your top tracked role';
}

function explainMatch(context) {
  const job = context.selectedJob || context.recentJobs[0];
  if (!job) {
    return {
      reply: 'Upload a resume and run a job scan first. I need jobs in your tracker to explain match scores.',
      suggestions: ['Run a Job Hunt scan', 'Upload your resume in Job Hunt'],
    };
  }
  const matched = job.matchedSkills?.length ? job.matchedSkills.join(', ') : 'limited overlap detected';
  const missing = job.missingSkills?.length ? job.missingSkills.join(', ') : 'none flagged';
  return {
    reply: [
      `For **${job.title}** at **${job.company}** (${job.score ?? '—'}% match):`,
      '',
      `**Matched skills:** ${matched}`,
      `**Missing from job text:** ${missing}`,
      `**Location:** ${job.location || 'Not listed'} · **Visa signals:** ${job.visaFit || 'unknown'}`,
      '',
      'The score blends resume skill overlap, title alignment, location fit, visa signals, and listing quality. Re-scan after updating your resume to refresh scores.',
    ].join('\n'),
    suggestions: ['Suggest resume changes for this role', 'Generate recruiter message', 'Prepare interview talking points'],
  };
}

function suggestResumeChanges(context) {
  const job = context.selectedJob || context.recentJobs[0];
  const skills = context.candidate.skills.slice(0, 8).join(', ') || 'your core stack';
  const missing = job?.missingSkills?.slice(0, 5).join(', ') || 'keywords from the job description';
  return {
    reply: [
      `Resume suggestions for **${jobRef(context)}**:`,
      '',
      `1. Add a tailored summary mentioning ${job?.title || 'the target title'} and ${skills}.`,
      `2. Address gaps honestly if you have experience with: ${missing}.`,
      `3. Quantify recent wins (latency, users, revenue, cost) in your top 3 bullets.`,
      context.resume.excerpt
        ? `4. Reuse strong phrasing from your current resume opening: "${context.resume.excerpt.slice(0, 160)}…"`
        : '4. Upload a parsed resume so I can reference your actual summary text.',
    ].join('\n'),
    suggestions: ['Explain match score', 'Generate application packet from Job Results'],
  };
}

function prepareInterview(context) {
  const job = context.selectedJob || context.recentJobs[0];
  const company = job?.company || 'the company';
  const title = job?.title || 'this role';
  const topics = job?.matchedSkills?.slice(0, 4).join(', ') || context.candidate.skills.slice(0, 4).join(', ') || 'core technical fundamentals';
  return {
    reply: [
      `Interview prep for **${title}** at **${company}**:`,
      '',
      '**Likely topics:** ' + topics,
      '',
      '**Prepare 2 STAR stories** covering: production incident, cross-team delivery, and learning something new quickly.',
      '**Questions to ask:** team structure, success metrics for the role, onboarding, and visa/sponsorship policy if relevant.',
      '**Technical refresh:** revisit projects where you used the matched skills and be ready to go one level deeper on tradeoffs.',
    ].join('\n'),
    suggestions: ['Generate recruiter message', 'Explain match score'],
  };
}

function generateRecruiterMessage(context) {
  const job = context.selectedJob || context.recentJobs[0];
  const name = context.candidate.name;
  const company = job?.company || '[Company]';
  const title = job?.title || '[Role]';
  const skills = context.candidate.skills.slice(0, 4).join(', ') || 'relevant experience';
  const body = [
    `Hello ${company} Recruiting Team,`,
    '',
    `I recently applied for the ${title} position and wanted to introduce myself. I'm ${name}, with background in ${skills}.`,
    '',
    `I'm excited about the opportunity and would welcome a brief conversation about fit and timeline.`,
    '',
    'Thank you,',
    name,
    context.candidate.email,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    reply: `**Subject:** Application follow-up — ${title}\n\n${body}`,
    suggestions: ['Prepare interview', 'Recommend next action'],
  };
}

function explainRejection(context) {
  const job = context.selectedJob;
  const reasons = job?.rejectionReasons?.length
    ? job.rejectionReasons
    : job?.score != null && job.score < 50
      ? ['Score below recommended threshold']
      : ['No explicit rejection recorded'];
  const missing = job?.missingSkills?.slice(0, 5).join(', ');
  return {
    reply: [
      job
        ? `For **${job.title}** at **${job.company}**, likely exclusion reasons:`
        : 'Select a job (pass jobId) for role-specific rejection analysis. General reasons jobs are filtered out:',
      '',
      ...reasons.map((r) => `• ${r}`),
      missing ? `\n**Skill gaps:** ${missing}` : '',
      '',
      'Check the Recommended tab filters (match threshold, visa fit) and the job drawer breakdown for details.',
    ]
      .filter(Boolean)
      .join('\n'),
    suggestions: ['Suggest resume changes', 'Recommend next action'],
  };
}

function recommendNextAction(context) {
  const apps = context.applications;
  const pendingFollowUp = apps.filter((a) => a.followUpDate).slice(0, 2);
  const topJob = context.selectedJob || context.recentJobs.find((j) => (j.score || 0) >= 65) || context.recentJobs[0];
  const lines = ['**Recommended next actions:**', ''];

  if (!context.resume.loaded) {
    lines.push('1. **Upload and parse your resume** — required for accurate matching.');
  } else if (!context.recentJobs.length) {
    lines.push('1. **Run a Job Hunt scan** to populate your pipeline.');
  } else {
    if (topJob) {
      lines.push(`1. **Review ${topJob.title} at ${topJob.company}** (${topJob.score}% match) — generate packet or track application.`);
    }
    if (pendingFollowUp.length) {
      lines.push(`2. **Follow up** with ${pendingFollowUp.map((a) => a.company).join(', ')} (follow-up date set).`);
    }
    lines.push(`${pendingFollowUp.length ? '3' : '2'}. **Apply to 2–3 high-match roles** this week and log them in Applications.`);
  }

  return {
    reply: lines.join('\n'),
    suggestions: ['Explain match score', 'Generate recruiter message'],
  };
}

const HANDLERS = {
  explain_match: explainMatch,
  suggest_resume_changes: suggestResumeChanges,
  prepare_interview: prepareInterview,
  generate_recruiter_message: generateRecruiterMessage,
  explain_rejection: explainRejection,
  recommend_next_action: recommendNextAction,
};

export async function runTemplateCopilotChat(context, { action, message = '' }) {
  const handler = HANDLERS[action];
  if (!handler) {
    return {
      provider: 'template',
      action,
      reply: `Unknown action "${action}". Supported: ${Object.keys(HANDLERS).join(', ')}`,
      suggestions: [],
    };
  }

  const result = handler(context);
  let reply = result.reply;
  if (message?.trim()) {
    reply += `\n\n---\n*Regarding your note:* ${message.trim()}`;
  }

  return {
    provider: 'template',
    action,
    actionLabel: ACTION_LABELS[action] || action,
    reply,
    suggestions: result.suggestions || [],
    timestamp: new Date().toISOString(),
  };
}
