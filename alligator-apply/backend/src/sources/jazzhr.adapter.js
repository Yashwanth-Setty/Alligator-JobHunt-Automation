import { JobSourceAdapter } from './base.adapter.js';

export class JazzHRAdapter extends JobSourceAdapter {
  constructor(config = {}) {
    super({ name: 'jazzhr', atsType: 'jazzhr', implemented: false, ...config });
  }
  async fetchJobs() {
    throw new Error('JazzHR adapter not implemented yet');
  }
  normalize() {
    throw new Error('JazzHR adapter not implemented yet');
  }
}
