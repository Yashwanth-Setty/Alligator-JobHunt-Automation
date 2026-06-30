import { JobSourceAdapter } from './base.adapter.js';

export class JobviteAdapter extends JobSourceAdapter {
  constructor(config = {}) {
    super({ name: 'jobvite', atsType: 'jobvite', implemented: false, ...config });
  }
  async fetchJobs() {
    throw new Error('Jobvite adapter not implemented yet');
  }
  normalize() {
    throw new Error('Jobvite adapter not implemented yet');
  }
}
