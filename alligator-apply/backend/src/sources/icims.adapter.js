import { JobSourceAdapter } from './base.adapter.js';

export class ICimsAdapter extends JobSourceAdapter {
  constructor(config = {}) {
    super({ name: 'icims', atsType: 'icims', implemented: false, ...config });
  }
  async fetchJobs() {
    throw new Error('iCIMS adapter not implemented yet');
  }
  normalize() {
    throw new Error('iCIMS adapter not implemented yet');
  }
}
