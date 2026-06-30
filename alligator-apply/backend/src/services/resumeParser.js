/**
 * PDF/DOCX resume text extraction and lightweight profile parsing.
 */

import fs from 'fs';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const MIN_TEXT_LENGTH = 100;
const MAX_STORED_TEXT = 100_000;

const SECTION_PATTERNS = [
  ['skills', /\b(?:technical\s+skills|core\s+competencies|^skills)\b/im],
  ['experience', /\b(?:professional\s+experience|work\s+experience|^experience)\b/im],
  ['education', /\b(?:^education|academic\s+background)\b/im],
  ['summary', /\b(?:professional\s+summary|summary|profile)\b/im],
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}(?:\s*(?:ext|x)\.?\s*\d+)?/i;
const YEARS_RE =
  /(\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp)/i;
const LOCATION_RE =
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*(?:[A-Z]{2}|[A-Za-z]+))\b/;
const REMOTE_RE = /\b(remote|hybrid|work from home)\b/i;

const SKILL_LINE_SPLIT = /[,;|/]/;

function normalizeText(text = '') {
  return String(text)
    .replace(/\u2022/g, '•')
    .replace(/\ufffd/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSections(fullText) {
  const sections = { summary: '', skills: '', experience: '', education: '' };
  if (!fullText) return sections;

  const markers = [];
  for (const [key, pattern] of SECTION_PATTERNS) {
    const match = pattern.exec(fullText);
    if (match) markers.push({ index: match.index, key, header: match[0] });
  }
  markers.sort((a, b) => a.index - b.index);

  if (!markers.length) {
    sections.summary = fullText.slice(0, 2000);
    return sections;
  }

  for (let i = 0; i < markers.length; i += 1) {
    const { index, key } = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].index : fullText.length;
    let chunk = fullText.slice(index, end);
    chunk = chunk.replace(/^[^\n]+\n?/, '').trim();
    sections[key] = chunk;
  }

  return sections;
}

function extractSkillTokens(skillsText) {
  if (!skillsText) return [];
  const tokens = [];
  for (const line of skillsText.split('\n')) {
    let cleaned = line.trim().replace(/^[•\-*]\s*/, '');
    if (!cleaned) continue;
    if (cleaned.includes(':')) {
      const [, vals] = cleaned.split(':', 2);
      for (const part of vals.split(SKILL_LINE_SPLIT)) {
        const t = part.trim();
        if (t.length > 1) tokens.push(t);
      }
    } else {
      for (const part of cleaned.split(SKILL_LINE_SPLIT)) {
        const t = part.trim();
        if (t.length > 2) tokens.push(t);
      }
    }
  }
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    const low = t.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      out.push(t);
    }
  }
  return out.slice(0, 80);
}

function guessName(lines, email) {
  for (const line of lines.slice(0, 8)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 80) continue;
    if (EMAIL_RE.test(trimmed) || PHONE_RE.test(trimmed)) continue;
    if (/^(resume|curriculum vitae|cv)$/i.test(trimmed)) continue;
    if (/@|https?:\/\//i.test(trimmed)) continue;
    if (/^\d/.test(trimmed)) continue;
    if (email && trimmed.toLowerCase().includes(email.toLowerCase())) continue;
    const words = trimmed.split(/\s+/);
    if (words.length >= 2 && words.length <= 5 && /^[A-Za-z][A-Za-z.'-]*$/.test(words[0])) {
      return trimmed;
    }
  }
  return '';
}

function guessLocation(text, lines) {
  for (const line of lines.slice(0, 12)) {
    if (REMOTE_RE.test(line)) {
      const m = line.match(REMOTE_RE);
      return m ? m[0] : line.trim();
    }
    const loc = line.match(LOCATION_RE);
    if (loc) return loc[1];
  }
  const bodyLoc = text.match(LOCATION_RE);
  return bodyLoc ? bodyLoc[1] : '';
}

function estimateYearsOfExperience(text, experienceSection) {
  const haystack = `${experienceSection}\n${text.slice(0, 4000)}`;
  const explicit = haystack.match(YEARS_RE);
  if (explicit) return Number(explicit[1]);

  const currentYear = new Date().getFullYear();
  const years = [];
  const rangeRe = /\b(19|20)\d{2}\s*[-–—]\s*(?:present|(19|20)\d{2})\b/gi;
  let match;
  while ((match = rangeRe.exec(haystack)) !== null) {
    const start = Number(match[0].slice(0, 4));
    const endToken = match[0].split(/[-–—]/)[1]?.trim().toLowerCase();
    const end = endToken === 'present' ? currentYear : Number(endToken?.slice(-4));
    if (start >= 1970 && start <= currentYear && end >= start && end <= currentYear + 1) {
      years.push(end - start);
    }
  }
  if (!years.length) return null;
  return Math.max(...years);
}

export function extractProfile(fullText, sections = {}) {
  const text = normalizeText(fullText);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const emailMatch = text.match(EMAIL_RE);
  const phoneMatch = text.match(PHONE_RE);
  const email = emailMatch ? emailMatch[0] : '';
  const phone = phoneMatch ? phoneMatch[0].trim() : '';
  let skillsFromSection = extractSkillTokens(sections.skills || '');
  if (!skillsFromSection.length) {
    const inline = text.match(/\b(?:technical\s+skills|core\s+competencies|skills)\b[:\s-]*([^\n]+)/i);
    if (inline) {
      let chunk = inline[1];
      const stop = chunk.search(/\b(?:experience|education|employment)\b/i);
      if (stop > 0) chunk = chunk.slice(0, stop);
      skillsFromSection = extractSkillTokens(chunk);
    }
  }
  const name = guessName(lines, email);
  const location = guessLocation(text, lines);
  const yearsOfExperience = estimateYearsOfExperience(text, sections.experience || '');

  return {
    name,
    email,
    phone,
    location,
    skills: skillsFromSection,
    yearsOfExperience,
  };
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return {
      text: normalizeText(result.text || ''),
      pagesParsed: result.total || 0,
    };
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: normalizeText(result.value || ''),
    pagesParsed: 1,
  };
}

/**
 * @param {Buffer} buffer
 * @param {'.pdf'|'.docx'} ext
 */
export async function parseResumeBuffer(buffer, ext) {
  if (!buffer?.length) {
    return {
      ok: false,
      error: 'Empty file',
      extractedText: '',
      pagesParsed: 0,
      sections: {},
      profile: extractProfile(''),
      charCount: 0,
    };
  }

  try {
    let extracted;
    if (ext === '.pdf') {
      extracted = await extractPdfText(buffer);
    } else if (ext === '.docx') {
      extracted = await extractDocxText(buffer);
    } else {
      return {
        ok: false,
        error: 'Unsupported file type',
        extractedText: '',
        pagesParsed: 0,
        sections: {},
        profile: extractProfile(''),
        charCount: 0,
      };
    }

    const { text, pagesParsed } = extracted;
    if (!text) {
      return {
        ok: false,
        error: 'No readable text found in file',
        extractedText: '',
        pagesParsed,
        sections: {},
        profile: extractProfile(''),
        charCount: 0,
      };
    }

    if (text.length < MIN_TEXT_LENGTH) {
      return {
        ok: false,
        error: `Parsed text too short (${text.length} chars) — file may be scanned images or corrupt`,
        extractedText: text.slice(0, MAX_STORED_TEXT),
        pagesParsed,
        sections: splitSections(text),
        profile: extractProfile(text, splitSections(text)),
        charCount: text.length,
      };
    }

    const sections = splitSections(text);
    const profile = extractProfile(text, sections);
    const storedText = text.slice(0, MAX_STORED_TEXT);

    return {
      ok: true,
      error: '',
      extractedText: storedText,
      pagesParsed,
      sections,
      profile,
      charCount: text.length,
    };
  } catch (err) {
    const message = err?.message || 'Failed to parse resume';
    const corruptHints = /invalid|corrupt|password|encrypted|unsupported/i.test(message)
      ? message
      : `Unable to parse file: ${message}`;
    return {
      ok: false,
      error: corruptHints.slice(0, 300),
      extractedText: '',
      pagesParsed: 0,
      sections: {},
      profile: extractProfile(''),
      charCount: 0,
    };
  }
}

export async function parseResumeFile(filePath, ext) {
  const buffer = fs.readFileSync(filePath);
  return parseResumeBuffer(buffer, ext);
}

export { MIN_TEXT_LENGTH };
