/**
 * Smoke test for application packet generation and file output.
 * Run: npm run test:packet
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../src/db/database.js';
import { buildPacketContext } from '../src/agents/packetContext.js';
import { generateApplicationPacket } from '../src/agents/careerAgent.js';
import { generatePacketForJob, writePacketFiles, PACKETS_DIR } from '../src/services/packetService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

async function testTemplatePacket() {
  console.log('\n── template packet ──');
  const context = buildPacketContext({
    job: {
      id: 'test-job-1',
      title: 'Senior Java Engineer',
      company: 'TechCo',
      location: 'Remote US',
      url: 'https://example.com/jobs/1',
      description: 'Java Spring Boot AWS Kubernetes microservices',
      score: 88,
      visa_fit: 'positive',
      required_skills: ['Java', 'Spring Boot', 'AWS'],
      missing_skills: ['Kafka'],
    },
    resumeRow: {
      file_name: 'resume.pdf',
      extracted_text:
        'Jane Developer. 8 years building Java microservices with Spring Boot, AWS, and Kubernetes. Led API modernization initiatives.',
      parse_status: 'success',
      parsed_profile: JSON.stringify({
        name: 'Jane Developer',
        email: 'jane@example.com',
        skills: ['Java', 'Spring Boot', 'AWS', 'Kubernetes'],
        yearsOfExperience: 8,
      }),
    },
    settings: { fullName: 'Jane Developer', email: 'jane@example.com', visaStatus: 'cpt' },
  });

  const packet = await generateApplicationPacket(context);
  assert(packet.coverLetter.includes('TechCo'), 'cover letter mentions company');
  assert(packet.recruiterEmail.subject, 'recruiter email subject present');
  assert(packet.linkedInMessage.length > 0, 'linkedin message present');
  assert(packet.followUpEmail.body.includes('follow up'), 'follow-up email present');
  assert(packet.applicationAnswers.length >= 5, 'application answer guidance present');
  assert(packet.resumeImprovements.length >= 2, 'resume improvements present');

  const paths = writePacketFiles(context.job, packet);
  assert(fs.existsSync(paths.jsonPath), 'json packet file created');
  assert(fs.existsSync(paths.markdownPath), 'markdown packet file created');
  console.log(`  json: ${paths.relativeJsonPath}`);
  console.log(`  md:   ${paths.relativeMarkdownPath}`);
}

async function testDbJobPacket() {
  console.log('\n── db job packet ──');
  getDb();
  const resume = getDb()
    .prepare("SELECT * FROM resume_profiles WHERE is_active = 1 AND parse_status = 'success' LIMIT 1")
    .get();
  const job = getDb().prepare('SELECT id FROM jobs ORDER BY score DESC LIMIT 1').get();

  if (!resume || !job) {
    console.log('  ○ skipped — need active parsed resume and at least one job in DB');
    return;
  }

  const result = await generatePacketForJob(job.id);
  assert(result.success, 'packet generation succeeded');
  assert(fs.existsSync(result.paths.jsonPath), 'db integration json file exists');
  assert(fs.existsSync(result.paths.markdownPath), 'db integration markdown file exists');
  assert(result.packet.coverLetter, 'packet content returned to caller');
  console.log(`  provider: ${result.provider}`);
  console.log(`  path: ${result.paths.relativeMarkdownPath}`);
}

async function main() {
  fs.mkdirSync(PACKETS_DIR, { recursive: true });
  let failed = 0;
  for (const fn of [testTemplatePacket, testDbJobPacket]) {
    try {
      await fn();
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${err.message}`);
    }
  }
  console.log(`\n── summary: ${failed === 0 ? 'all packet checks passed' : `${failed} failed`} ──`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
