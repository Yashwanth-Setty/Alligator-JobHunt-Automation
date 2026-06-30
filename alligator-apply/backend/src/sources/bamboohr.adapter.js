import { JobSourceAdapter } from './base.adapter.js';

/** @extends {JobSourceAdapter} */
export class BambooHRAdapter extends JobSourceAdapter {
  constructor(config = {}) {
    super({ name: 'bamboohr', atsType: 'bamboohr', implemented: false, ...config });
  }
  async fetchJobs() {
    throw new Error('BambooHR adapter not implemented yet');
  }
  normalize() {
    throw new Error('BambooHR adapter not implemented yet');
  }
}
