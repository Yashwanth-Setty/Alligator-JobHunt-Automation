/** Standalone job scan worker entry (future: queue consumer) */
import 'dotenv/config';
import { getDb } from '../db/database.js';
import { startScanJob, getScanStatus } from '../services/jobScanService.js';

getDb();
console.log('Job scan worker ready');
const result = startScanJob((s) => console.log(JSON.stringify(s)));
console.log('Started:', result, getScanStatus());
