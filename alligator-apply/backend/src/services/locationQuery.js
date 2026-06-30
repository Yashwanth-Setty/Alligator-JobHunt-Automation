import { getDb } from '../db/database.js';
import { buildBaseWhereClause } from './jobQuery.js';
import {
  getLocationSuggestions,
  getLocationDidYouMean,
  normalizeLocation,
  PRESET_LOCATION_SUGGESTIONS,
} from './locationService.js';
import { getActiveScanRunId } from './scanMetrics.js';

export function backfillNormalizedLocations() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, location FROM jobs WHERE normalized_location IS NULL OR normalized_location = ''`
    )
    .all();
  if (!rows.length) return 0;
  const update = db.prepare('UPDATE jobs SET normalized_location = ? WHERE id = ?');
  const tx = db.transaction((items) => {
    for (const row of items) {
      update.run(normalizeLocation(row.location), row.id);
    }
  });
  tx(rows);
  return rows.length;
}

export function suggestLocations(query = '', limit = 10) {
  const db = getDb();
  const scanRunId = getActiveScanRunId();
  let sql = `SELECT DISTINCT location FROM jobs WHERE COALESCE(is_hidden,0)=0 AND location IS NOT NULL AND location != ''`;
  const params = {};
  if (scanRunId) {
    sql += ' AND scan_run_id = @scanRunId';
    params.scanRunId = scanRunId;
  }
  sql += ' ORDER BY location LIMIT 200';
  const fromDb = db.prepare(sql).all(params).map((r) => r.location);
  return getLocationSuggestions(query, { limit, fromDb });
}

export function getLocationStats(filters = {}) {
  const db = getDb();
  const { location: _loc, ...rest } = filters;
  const { whereSql, params } = buildBaseWhereClause(rest);

  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(normalized_location,''), 'Unknown') AS region, COUNT(*) AS count
       FROM jobs WHERE ${whereSql}
       GROUP BY region
       ORDER BY count DESC
       LIMIT 20`
    )
    .all(params);

  return rows.map((r) => ({
    label: r.region,
    value: r.region,
    count: r.count,
  }));
}

export function getLocationHintsForQuery(locationInput, filters = {}) {
  if (!locationInput) return null;
  const db = getDb();
  const { whereSql, params } = buildBaseWhereClause(filters);
  const count = db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${whereSql}`).get(params).c;
  if (count > 0) return null;

  return {
    query: locationInput,
    suggestions: getLocationDidYouMean(locationInput),
    presets: PRESET_LOCATION_SUGGESTIONS.slice(0, 6).map((s) => s.label),
  };
}
