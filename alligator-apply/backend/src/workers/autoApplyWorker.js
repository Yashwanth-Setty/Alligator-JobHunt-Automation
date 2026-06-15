/** Standalone auto-apply worker entry (future: queue consumer) */
import 'dotenv/config';
import { getDb } from '../db/database.js';
import { startBatchAutoApply, getAutoApplyStatus } from '../services/autoApplyService.js';

getDb();
console.log('Auto-apply worker ready');
const result = startBatchAutoApply((s) => console.log(JSON.stringify(s)));
console.log('Started:', result, getAutoApplyStatus());
