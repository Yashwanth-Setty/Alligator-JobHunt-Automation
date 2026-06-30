#!/usr/bin/env node
/**
 * Isolated live provider fetch — one target, no filters, no DB.
 *
 * Usage:
 *   npm run debug:greenhouse
 *   npm run debug:ashby
 *   npm run debug:workday
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJson, fetchJsonPost } from '../src/sources/httpClient.js';
import { GreenhouseAdapter } from '../src/sources/greenhouse.adapter.js';
import { AshbyAdapter } from '../src/sources/ashby.adapter.js';
import { WorkdayAdapter } from '../src/sources/workday.adapter.js';
import {
  buildCxsJobsRequestBody,
  buildCxsJobsUrl,
  buildWorkdayCareersUrl,
  resolveWorkdayTarget,
} from '../src/sources/workdayCxs.js';
import { getSourceTimeoutMs } from '../src/sources/scanConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

process.env.MOCK_MODE = 'false';

const PROVIDERS = {
  greenhouse: {
    target: 'stripe',
    label: 'Greenhouse',
    run: verifyGreenhouse,
  },
  ashby: {
    target: 'Ashby',
    label: 'Ashby',
    run: verifyAshby,
  },
  workday: {
    target: 'nvidia::NVIDIAExternalCareerSite',
    label: 'Workday',
    run: verifyWorkday,
  },
};

const NVIDIA_TARGET = {
  boardToken: 'nvidia::NVIDIAExternalCareerSite',
  companyName: 'NVIDIA',
  connectionPayload: {
    tenant: 'nvidia',
    wdInstance: 'wd5',
    hostSlug: 'nvidia',
    site: 'NVIDIAExternalCareerSite',
    locale: 'en-US',
    pageSize: 20,
    fetchDetails: false,
  },
};

function printSection(title, rows) {
  console.log(`\n=== ${title} ===`);
  for (const [key, value] of rows) {
    if (Array.isArray(value)) {
      console.log(`${key}:`);
      value.forEach((line, i) => console.log(`  ${i + 1}. ${line}`));
    } else if (value === null || value === undefined) {
      console.log(`${key}: null`);
    } else {
      console.log(`${key}: ${value}`);
    }
  }
}

async function stopActiveUiScan() {
  try {
    const res = await fetch('http://localhost:4000/api/jobs/scan/stop', { method: 'POST' });
    if (res.ok) {
      const body = await res.json();
      if (body?.status && body.status !== 'idle') {
        console.log(`[debug] stopped UI scan (status=${body.status})`);
      }
    }
  } catch {
    // backend not running — nothing to stop
  }
}

async function verifyGreenhouse() {
  const target = PROVIDERS.greenhouse.target;
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target)}/jobs`;
  let httpStatus = null;
  const timeoutMs = getSourceTimeoutMs();

  try {
    const data = await fetchJson(url, {
      timeoutMs,
      onHttpResponse: (r) => {
        httpStatus = r.status;
      },
    });
    const apiJobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const adapter = new GreenhouseAdapter();
    const normalized = apiJobs.map((job) =>
      adapter.normalize({ ...job, _boardToken: target }, target)
    );

    printSection('greenhouse provider verify', [
      ['target', target],
      ['requestUrl', url],
      ['httpStatus', httpStatus ?? 200],
      ['rawJobCount', apiJobs.length],
      ['rawJobTitles (first 5)', apiJobs.slice(0, 5).map((j) => j.title || '(no title)')],
      ['normalizedCount', normalized.length],
      ['normalizedTitles (first 5)', normalized.slice(0, 5).map((j) => j.title || '(no title)')],
    ]);
    return apiJobs.length > 0 ? 0 : 0;
  } catch (err) {
    printSection('greenhouse provider verify', [
      ['target', target],
      ['requestUrl', url],
      ['httpStatus', err.httpStatus ?? httpStatus ?? 'error'],
      ['error', err.message],
      ['httpBody', err.httpBody ? String(err.httpBody).slice(0, 500) : null],
      ['rawJobCount', 0],
      ['normalizedCount', 0],
    ]);
    return 1;
  }
}

async function verifyAshby() {
  const target = PROVIDERS.ashby.target;
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(target)}`;
  let httpStatus = null;
  const timeoutMs = getSourceTimeoutMs();

  try {
    const data = await fetchJson(url, {
      timeoutMs,
      onHttpResponse: (r) => {
        httpStatus = r.status;
      },
    });
    const apiJobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const adapter = new AshbyAdapter();
    const normalized = apiJobs.map((job) =>
      adapter.normalize({ ...job, _boardName: target }, target)
    );

    printSection('ashby provider verify', [
      ['target', target],
      ['requestUrl', url],
      ['httpStatus', httpStatus ?? 200],
      ['rawJobCount', apiJobs.length],
      ['rawJobTitles (first 5)', apiJobs.slice(0, 5).map((j) => j.title || '(no title)')],
      ['normalizedCount', normalized.length],
      ['normalizedTitles (first 5)', normalized.slice(0, 5).map((j) => j.title || '(no title)')],
    ]);
    return 0;
  } catch (err) {
    printSection('ashby provider verify', [
      ['target', target],
      ['requestUrl', url],
      ['httpStatus', err.httpStatus ?? httpStatus ?? 'error'],
      ['error', err.message],
      ['httpBody', err.httpBody ? String(err.httpBody).slice(0, 500) : null],
      ['rawJobCount', 0],
      ['normalizedCount', 0],
    ]);
    return 1;
  }
}

async function verifyWorkday() {
  const targetLabel = PROVIDERS.workday.target;
  const target = NVIDIA_TARGET;
  const config = resolveWorkdayTarget(target);
  const url = buildCxsJobsUrl(config);
  const referer = buildWorkdayCareersUrl(config);
  const body = buildCxsJobsRequestBody({}, config, 0);
  let httpStatus = null;
  const timeoutMs = getSourceTimeoutMs();

  try {
    const data = await fetchJsonPost(url, body, {
      timeoutMs,
      headers: { Referer: referer },
      onHttpResponse: (r) => {
        httpStatus = r.status;
      },
    });
    const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
    const adapter = new WorkdayAdapter();
    const normalized = postings.map((posting) =>
      adapter.normalize(
        { posting, detail: null, _workdayConfig: config },
        { target, config }
      )
    );

    printSection('workday provider verify', [
      ['target', targetLabel],
      ['requestUrl', url],
      ['httpMethod', 'POST'],
      ['httpStatus', httpStatus ?? 200],
      ['apiTotal', data?.total ?? null],
      ['rawJobCount', postings.length],
      ['rawJobTitles (first 5)', postings.slice(0, 5).map((j) => j.title || '(no title)')],
      ['normalizedCount', normalized.length],
      ['normalizedTitles (first 5)', normalized.slice(0, 5).map((j) => j.title || '(no title)')],
    ]);
    return 0;
  } catch (err) {
    printSection('workday provider verify', [
      ['target', targetLabel],
      ['requestUrl', url],
      ['httpMethod', 'POST'],
      ['httpStatus', err.httpStatus ?? httpStatus ?? 'error'],
      ['error', err.message],
      ['httpBody', err.httpBody ? String(err.httpBody).slice(0, 500) : null],
      ['rawJobCount', 0],
      ['normalizedCount', 0],
    ]);
    return 1;
  }
}

async function main() {
  const provider = (process.argv[2] || '').toLowerCase();
  const spec = PROVIDERS[provider];
  if (!spec) {
    console.error(`Usage: node scripts/debugProviderVerify.js <${Object.keys(PROVIDERS).join('|')}>`);
    process.exit(1);
  }

  await stopActiveUiScan();

  console.log(`MOCK_MODE=false (live fetch)`);
  console.log(`provider: ${spec.label}`);
  console.log(`target: ${spec.target}`);
  console.log(`filters: none (no keyword/location/minScore)`);
  console.log(`persist: no`);

  const code = await spec.run();
  process.exit(code);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
