/**
 * Smoke test for PDF/DOCX resume parsing.
 * Usage: npm run test:resume [path/to/resume.pdf]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseResumeBuffer, extractProfile } from '../src/services/resumeParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MINIMAL_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 312 >>stream
BT /F1 11 Tf 72 720 Td (Jane Developer) Tj T* (jane.developer@email.com) Tj T* (415-555-0199) Tj T* (San Francisco, CA) Tj T* (SKILLS) Tj T* (Java, Spring Boot, React, AWS, Kubernetes) Tj T* (EXPERIENCE) Tj T* (8 years of software engineering experience building APIs.) Tj ET
endstream endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000628 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
705
%%EOF`,
  'binary'
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runPdfFixture(label, buffer) {
  const result = await parseResumeBuffer(buffer, '.pdf');
  console.log(`\n── ${label} ──`);
  console.log(`  ok: ${result.ok}`);
  console.log(`  chars: ${result.charCount}`);
  console.log(`  pages: ${result.pagesParsed}`);
  console.log(`  name: ${result.profile.name || '(none)'}`);
  console.log(`  email: ${result.profile.email || '(none)'}`);
  console.log(`  phone: ${result.profile.phone || '(none)'}`);
  console.log(`  location: ${result.profile.location || '(none)'}`);
  console.log(`  skills: ${result.profile.skills.slice(0, 6).join(', ') || '(none)'}`);
  console.log(`  years: ${result.profile.yearsOfExperience ?? '(none)'}`);
  if (!result.ok) console.log(`  error: ${result.error}`);
  return result;
}

async function main() {
  let passed = 0;
  let failed = 0;

  const tests = [];

  tests.push(async () => {
    const r = await runPdfFixture('minimal PDF', MINIMAL_PDF);
    assert(r.ok, 'minimal PDF should parse');
    assert(r.charCount >= 100, 'minimal PDF should meet min length');
    assert(r.profile.email === 'jane.developer@email.com', 'email extracted');
    assert(r.profile.skills.length >= 3, 'skills extracted');
    passed += 1;
  });

  tests.push(async () => {
    const r = await parseResumeBuffer(Buffer.from('hello'), '.pdf');
    assert(!r.ok, 'corrupt buffer should fail');
    passed += 1;
    console.log('\n── corrupt PDF ──');
    console.log(`  ok: ${r.ok} (expected false)`);
    console.log(`  error: ${r.error}`);
  });

  tests.push(async () => {
    const profile = extractProfile('John Smith\njohn@example.com\n5 years of experience');
    assert(profile.email === 'john@example.com', 'profile email');
    passed += 1;
    console.log('\n── profile extractor ──');
    console.log(`  email: ${profile.email}`);
    console.log(`  years: ${profile.yearsOfExperience}`);
  });

  const customPath = process.argv[2];
  const defaultPath = path.join(__dirname, '../uploads/resumes/resume.pdf');
  const filePath = customPath || (fs.existsSync(defaultPath) ? defaultPath : null);

  if (filePath) {
    tests.push(async () => {
      const ext = path.extname(filePath).toLowerCase();
      const buffer = fs.readFileSync(filePath);
      const { parseResumeBuffer: parse } = await import('../src/services/resumeParser.js');
      const r = await parse(buffer, ext === '.docx' ? '.docx' : '.pdf');
      console.log(`\n── file: ${path.basename(filePath)} ──`);
      console.log(`  ok: ${r.ok}`);
      console.log(`  chars: ${r.charCount}`);
      console.log(`  skills: ${r.profile.skills?.length ?? 0}`);
      if (!r.ok) console.log(`  error: ${r.error}`);
      assert(r.charCount > 0 || !r.ok, 'file parse attempted');
      passed += 1;
    });
  } else {
    console.log('\n○ No uploads/resumes/resume.pdf found — skip optional file test');
  }

  for (const t of tests) {
    try {
      await t();
    } catch (err) {
      failed += 1;
      console.error(`\n✗ ${err.message}`);
    }
  }

  console.log(`\n── summary: ${passed} passed, ${failed} failed ──`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
