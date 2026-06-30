import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, now } from '../db/database.js';
import { getActiveResume } from './resumeService.js';
import { buildPacketContext } from '../agents/packetContext.js';
import { generateApplicationPacket } from '../agents/careerAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKETS_DIR =
  process.env.PACKET_OUTPUT_DIR || path.join(__dirname, '../../outputs/application_packets');

function slugPart(value = '') {
  return String(value)
    .replace(/[^\w\s-]/g, '')
    .replace(/[-\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export function safePacketBasename(job) {
  const company = slugPart(job.company || 'company');
  const title = slugPart(job.title || 'role');
  const idPart = slugPart(String(job.id || '').slice(0, 12));
  return `${company}_${title}_${idPart}`.toLowerCase() || 'application_packet';
}

function loadSettingsProfile() {
  const rows = getDb().prepare('SELECT key, value FROM user_settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  return {
    fullName: settings.full_name || '',
    email: settings.email || '',
    phone: settings.phone || '',
    preferredLocations: settings.preferred_locations || '',
    visaStatus: settings.visa_status || '',
    profile: {
      fullName: settings.full_name || '',
      email: settings.email || '',
      phone: settings.phone || '',
    },
    preferences: {
      visaStatus: settings.visa_status || '',
    },
  };
}

export function formatPacketMarkdown(job, packet) {
  const lines = [
    `# Application Packet — ${job.title} @ ${job.company}`,
    '',
    `Generated: ${packet.generatedAt}`,
    `Provider: ${packet.provider}`,
    `Match score: ${packet.metadata?.matchScore ?? job.score ?? '—'}%`,
    '',
    '## Resume improvement suggestions',
    ...packet.resumeImprovements.map((s) => `- ${s}`),
    '',
    '## Cover letter',
    packet.coverLetter,
    '',
    '## Recruiter email',
    `Subject: ${packet.recruiterEmail.subject}`,
    '',
    packet.recruiterEmail.body,
    '',
    '## LinkedIn message',
    packet.linkedInMessage,
    '',
    '## Follow-up email',
    `Subject: ${packet.followUpEmail.subject}`,
    '',
    packet.followUpEmail.body,
    '',
    '## Application answer guidance',
  ];

  for (const item of packet.applicationAnswers) {
    lines.push(`### ${item.question}`);
    lines.push(`Guidance: ${item.guidance}`);
    lines.push(`Suggestion: ${item.suggestion}`);
    if (item.requiresConfirmation) lines.push('*(Requires manual confirmation before submit)*');
    lines.push('');
  }

  if (packet.providerNote) {
    lines.push('---', packet.providerNote, '');
  }

  return lines.join('\n');
}

export function writePacketFiles(job, packet) {
  fs.mkdirSync(PACKETS_DIR, { recursive: true });
  const base = safePacketBasename(job);
  const jsonPath = path.join(PACKETS_DIR, `${base}.json`);
  const mdPath = path.join(PACKETS_DIR, `${base}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(packet, null, 2), 'utf8');
  fs.writeFileSync(mdPath, formatPacketMarkdown(job, packet), 'utf8');

  return {
    jsonPath,
    markdownPath: mdPath,
    relativeJsonPath: path.relative(path.join(__dirname, '../..'), jsonPath).replace(/\\/g, '/'),
    relativeMarkdownPath: path.relative(path.join(__dirname, '../..'), mdPath).replace(/\\/g, '/'),
  };
}

export async function generatePacketForJob(jobId) {
  const { getJobById } = await import('./jobScanService.js');
  const job = getJobById(jobId);
  if (!job) return null;

  const resumeRow = getActiveResume();
  if (!resumeRow) {
    throw new Error('Upload and parse a resume before generating an application packet.');
  }
  if (resumeRow.parse_status !== 'success') {
    throw new Error('Resume parsing must succeed before generating a packet. Re-upload your resume.');
  }

  const settings = loadSettingsProfile();
  const context = buildPacketContext({ job, resumeRow, settings });
  const packet = await generateApplicationPacket(context);
  const paths = writePacketFiles(job, packet);

  const ts = now();
  getDb()
    .prepare("UPDATE jobs SET pipeline_status = 'ready_to_apply', updated_at = ? WHERE id = ?")
    .run(ts, jobId);

  return {
    success: true,
    jobId,
    provider: packet.provider,
    packet,
    paths,
    message: `Application packet saved to ${paths.relativeMarkdownPath}`,
  };
}

export { PACKETS_DIR };
