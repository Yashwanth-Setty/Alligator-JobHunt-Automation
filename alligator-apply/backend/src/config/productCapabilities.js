/**
 * Canonical feature map for the Node/React stack (alligator-apply).
 * Legacy Python (parent repo) may implement features marked legacy_only / not_implemented here.
 */

import { parseJobSources } from '../sources/sourceConfig.js';

const OPT_IN_JOB_SOURCES = ['workday'];

export function getProductCapabilities() {
  const mockMode = process.env.MOCK_MODE !== 'false';
  const openaiKeySet = Boolean(process.env.OPENAI_API_KEY?.trim());
  const activeSources = parseJobSources();

  return {
    canonicalStack: 'node-react',
    legacyStack: 'python-streamlit',
    legacyNote:
      'OpenAI scoring, Playwright apply, and scheduler exist only in the legacy Python tree until ported.',
    features: {
      jobScan: {
        status: mockMode ? 'mock' : 'live',
        sources: activeSources,
        optInSources: OPT_IN_JOB_SOURCES.filter((s) => !activeSources.includes(s)),
        detail:
          'Active sources follow JOB_SOURCES (minus any disabled in Settings). Workday requires registry seed: npm run registry:seed:workday.',
      },
      resumeParsing: {
        status: 'live',
        detail: 'PDF/DOCX text extraction with profile fields stored in resume_profiles.',
      },
      matchScoring: {
        status: 'live',
        detail: 'Resume skill-based heuristic scoring with matched/missing skills breakdown (matchScore.js).',
      },
      openaiScoring: {
        status: openaiKeySet ? 'legacy_only' : 'unavailable',
        detail: openaiKeySet
          ? 'OPENAI_API_KEY is set but unused by this stack; scoring lives in legacy Python (main.py).'
          : 'Not configured.',
      },
      autoApply: {
        status: mockMode ? 'disabled_mock_mode' : 'mock',
        detail: 'Playwright integration is a placeholder; no browser automation runs.',
      },
      packetGeneration: {
        status: 'live_template',
        detail: 'Template-based application packets written to outputs/application_packets (JSON + Markdown).',
      },
      scheduler: {
        status: 'not_implemented',
        detail: 'Scans are user-triggered only.',
      },
      watsonxAgent: {
        status: process.env.WATSONX_API_KEY && process.env.WATSONX_PROJECT_ID ? 'planned' : 'not_configured',
        detail:
          process.env.WATSONX_API_KEY && process.env.WATSONX_PROJECT_ID
            ? 'Credentials present; copilot and packets fall back to template until watsonx API is wired.'
            : 'Agent reasoning stub; watsonx API is not called.',
      },
      careerCopilot: {
        status: 'live_template',
        detail: 'Chat-style career guidance using resume, jobs, and applications context (template fallback).',
      },
    },
  };
}
