import { JobSourceAdapter } from './base.adapter.js';

export class TeamtailorAdapter extends JobSourceAdapter {
  constructor(config = {}) {
    super({ name: 'teamtailor', atsType: 'teamtailor', implemented: false, ...config });
  }
  async fetchJobs() {
    throw new Error('Teamtailor adapter not implemented yet');
  }
  normalize() {
    throw new Error('Teamtailor adapter not implemented yet');
  }
}
