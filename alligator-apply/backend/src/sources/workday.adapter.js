import { JobSourceAdapter, buildNormalizedJob } from './base.adapter.js';
import { legacyMockToJob } from './types.js';
import { fetchJson, fetchJsonPost } from './httpClient.js';
import { getTargetPlanForSource } from './sourceConfig.js';
import { getMaxCompaniesPerSource } from './scanConfig.js';
import { filterJobs, loadMockJobs, paginateJobs } from './utils.js';
import {
  fetchRegistryTargetsParallel,
  finalizeLiveSearch,
  isMockMode,
  mockDelay,
  stripHtml,
} from './liveSearch.js';
import { passesEarlyFilter } from './earlyFilter.js';
import { reportTargetFetch, reportTargetFetchError } from '../services/scanDiagnostics.js';
import {
  buildCxsJobDetailUrl,
  buildCxsJobsRequestBody,
  buildCxsJobsUrl,
  buildWorkdayApplyUrl,
  buildWorkdayCareersUrl,
  extractRequisitionId,
  parseWorkdayPostedDate,
  resolveWorkdayTarget,
  validateWorkdayTarget,
} from './workdayCxs.js';

export class WorkdayAdapter extends JobSourceAdapter {
  constructor(config = {}) {
    super({
      name: 'workday',
      atsType: 'workday',
      label: 'Workday',
      targetKind: 'connection_payload',
      implemented: true,
      ...config,
    });
  }

  metadata() {
    return {
      ...super.metadata(),
      label: 'Workday',
      implemented: true,
      targetKind: 'connection_payload',
      targetLabel: 'CXS connection payload',
      careersUrlTemplate:
        'https://{hostSlug}.{wdInstance}.myworkdayjobs.com/{locale}/{site}',
    };
  }

  validateTarget(target) {
    return validateWorkdayTarget(target);
  }

  discover() {
    const plan = getTargetPlanForSource('workday');
    return (plan.targets || []).map((t) => ({
      boardToken: t.boardToken,
      companyName: t.companyName || '',
      source: t.source,
      connectionPayload: t.connectionPayload || {},
      origin: t.origin,
    }));
  }

  async healthCheck(target, options = {}) {
    const validation = this.validateTarget(target);
    if (!validation.valid) return { ok: false, error: validation.error };
    if (isMockMode()) return { ok: true, mode: 'mock' };

    const started = Date.now();
    try {
      const config = resolveWorkdayTarget(target);
      const url = buildCxsJobsUrl(config);
      const data = await fetchJsonPost(
        url,
        buildCxsJobsRequestBody({}, config, 0),
        {
          timeoutMs: options.timeoutMs ?? Math.min(this.timeoutMs, 8000),
          headers: {
            Referer: buildWorkdayCareersUrl(config),
          },
        }
      );
      const count = Array.isArray(data?.jobPostings) ? data.jobPostings.length : 0;
      return { ok: true, latencyMs: Date.now() - started, sampleCount: count };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: err.message };
    }
  }

  async fetchJobs(filters = {}, options = {}) {
    const page = options.page || 1;
    const limit = Math.min(options.limit || this.maxResults, this.maxResults);

    if (isMockMode()) {
      await mockDelay();
      const pool = filterJobs(
        loadMockJobs().filter((j) => j.source === 'workday'),
        filters
      );
      const { jobs, total, hasMore } = paginateJobs(pool, page, limit);
      return {
        jobs,
        page,
        limit,
        total,
        hasMore,
        stats: { fetched: pool.length, afterFilters: pool.length },
      };
    }

    const targets = this.loadTargets(filters);
    if (targets.length === 0) {
      return finalizeLiveSearch([], filters, { page, limit }, { fetched: 0 });
    }

    const fetchStarted = Date.now();
    const { items: rawJobs, errors } = await fetchRegistryTargetsParallel(
      'workday',
      targets,
      (target) => this.fetchTargetJobs(target, filters),
      filters,
      { onCompanyDone: options.hooks?.onCompanyDone }
    );

    if (rawJobs.length === 0 && errors.length > 0) {
      throw new Error(errors.map((e) => `${e.target}: ${e.error}`).join('; '));
    }

    const normalized = rawJobs.map((raw) =>
      this.normalize(raw.job, { target: raw.target, config: raw.config })
    );

    return finalizeLiveSearch(normalized, filters, { page, limit }, {
      fetched: normalized.length,
      fetchMs: Date.now() - fetchStarted,
    });
  }

  loadTargets(filters = {}) {
    const plan = getTargetPlanForSource('workday');
    let targets = (plan.targets || []).map((t) => ({
      boardToken: t.boardToken,
      companyName: t.companyName || '',
      source: t.source,
      connectionPayload: t.connectionPayload || {},
      origin: t.origin,
    }));

    const companyFilter = (filters.company || '').toLowerCase();
    if (companyFilter) {
      targets = targets.filter(
        (t) =>
          (t.companyName || '').toLowerCase().includes(companyFilter) ||
          (t.boardToken || '').toLowerCase().includes(companyFilter)
      );
    }

    return targets.slice(0, getMaxCompaniesPerSource());
  }

  /**
   * @param {import('./providers/providerContract.js').ProviderTarget} target
   * @param {import('./types.js').SearchFilters} filters
   */
  async fetchTargetJobs(target, filters = {}) {
    const config = resolveWorkdayTarget(target);
    const url = buildCxsJobsUrl(config);
    const referer = buildWorkdayCareersUrl(config);
    const targetLabel = config.companyName || target.companyName || config.tenant || config.boardToken;
    let httpStatus = null;
    let rawFetchedTotal = 0;

    try {
      const collected = [];
      let offset = 0;
      let total = Infinity;

      while (collected.length < this.maxResults && offset < total) {
        const body = buildCxsJobsRequestBody(filters, config, offset);
        const data = await fetchJsonPost(url, body, {
          timeoutMs: this.timeoutMs,
          headers: { Referer: referer },
          onHttpResponse: (r) => {
            httpStatus = r.status;
          },
        });

        total = Number(data?.total ?? total);
        const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
        rawFetchedTotal += postings.length;
        if (postings.length === 0) break;

        for (const posting of postings) {
          const earlyJob = {
            title: posting.title || '',
            location: posting.locationsText || posting.location || '',
            company: config.companyName || target.companyName || config.tenant,
          };
          if (!passesEarlyFilter(earlyJob, filters, 'workday')) continue;

          let detail = null;
          if (config.fetchDetails && posting.externalPath) {
            detail = await this.fetchJobDetail(config, posting.externalPath, referer);
          }

          collected.push({
            target,
            config,
            job: { posting, detail, _workdayConfig: config },
          });
          if (collected.length >= this.maxResults) break;
        }

        offset += postings.length;
        if (postings.length < config.pageSize) break;
      }

      reportTargetFetch('workday', targetLabel, {
        url,
        httpStatus: httpStatus ?? 200,
        rawFetched: rawFetchedTotal,
        afterEarlyFilter: collected.length,
        normalized: collected.length,
        sampleRawTitles: collected.slice(0, 5).map((j) => j.job?.posting?.title),
      });

      return collected;
    } catch (err) {
      reportTargetFetchError('workday', targetLabel, {
        url,
        httpStatus: err.httpStatus ?? httpStatus,
        httpBody: err.httpBody ?? null,
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }
  }

  async fetchJobDetail(config, externalPath, referer) {
    try {
      const url = buildCxsJobDetailUrl(config, externalPath);
      return await fetchJson(url, {
        timeoutMs: Math.min(this.timeoutMs, 8000),
        headers: { Referer: referer },
      });
    } catch {
      return null;
    }
  }

  normalize(rawJob, context = {}) {
    if (this.isUnifiedJob(rawJob)) return rawJob;
    if (this.isLegacyMock(rawJob)) {
      return legacyMockToJob({ ...rawJob, source: 'workday', atsType: 'workday' });
    }

    const posting = rawJob.posting || rawJob;
    const detail = rawJob.detail || null;
    const config = context.config || rawJob._workdayConfig || resolveWorkdayTarget(context.target || {});
    const target = context.target || {};

    const info = detail?.jobPostingInfo || {};
    const title = posting.title || info.title || '';
    const location =
      posting.locationsText ||
      posting.location ||
      info.location ||
      info.jobRequisitionLocation?.descriptor ||
      '';
    const externalPath = posting.externalPath || '';
    const applyUrl = buildWorkdayApplyUrl(config, externalPath);
    const description = stripHtml(info.jobDescription || info.description || '');
    const postedDate =
      parseWorkdayPostedDate(posting.postedOn) ||
      (info.startDate ? String(info.startDate).slice(0, 10) : null);
    const employmentType = mapWorkdayTimeType(info.timeType || posting.timeType || '');

    const company =
      target.companyName ||
      config.companyName ||
      detail?.hiringOrganization?.name ||
      titleCaseToken(config.tenant);

    const job = buildNormalizedJob({
      source: 'workday',
      atsType: 'workday',
      company,
      title,
      location,
      employmentType,
      applyUrl,
      description,
      postedDate,
      rawData: {
        posting,
        detail,
        requisitionId: extractRequisitionId(posting),
        boardToken: config.boardToken,
        connectionPayload: {
          tenant: config.tenant,
          wdInstance: config.wdInstance,
          hostSlug: config.hostSlug,
          site: config.site,
        },
      },
    });

    job.autoApplyEligible = false;
    job.visaSignals = { fit: 'unknown', sponsorshipMentioned: false, cptMentioned: false };
    return job;
  }

  isUnifiedJob(job) {
    return Boolean(job?.source && job?.atsType && job?.applyUrl !== undefined);
  }

  isLegacyMock(job) {
    return String(job?.id || '').startsWith('mock-');
  }
}

function mapWorkdayTimeType(value = '') {
  const v = String(value).toLowerCase();
  if (v.includes('intern')) return 'internship';
  if (v.includes('part')) return 'part_time';
  if (v.includes('contract') || v.includes('fixed')) return 'contract';
  return 'full_time';
}

function titleCaseToken(value = '') {
  return String(value || '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
