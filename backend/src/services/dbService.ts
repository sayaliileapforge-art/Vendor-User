/**
 * DB Service — match CSV rows to extracted images and persist DataRecords.
 *
 * Matching algorithm (same logic as the existing /zip route):
 *   1. Exact match:     normalise(row.Name) === normaliseFilename(image.filename)
 *   2. Substring match: one normalised string contains the other
 *
 * This tolerates common naming differences between the CSV ("Vanshika Katiyar")
 * and the image filename ("145_Vanshika_Katiyar.jpg").
 */

import mongoose from 'mongoose';
import DataRecord from '../models/DataRecord';
import { normalize, normalizeFilename, getRecordName } from '../utils/normalizer';
import { createLogger } from '../utils/logger';

const log = createLogger('DbService');

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RowImageMatch {
  row:          Record<string, string>;
  /** Original filename of the matched image, or undefined if no match found. */
  matchedImage?: string;
}

export interface SaveRecordsResult {
  saved:  number;
  errors: string[];
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Match each CSV row to an image filename using normalised name comparison.
 *
 * @param rows            Parsed CSV rows (after field mapping applied).
 * @param imageFilenames  Basenames of extracted images.
 */
export function matchRowsWithImages(
  rows:           Record<string, string>[],
  imageFilenames: string[],
): RowImageMatch[] {
  // Build lookup: normalisedKey → original filename
  const imageMap = new Map<string, string>();
  for (const fn of imageFilenames) {
    const key = normalizeFilename(fn);
    if (key) imageMap.set(key, fn);
  }

  return rows.map((row) => {
    const rowName = normalize(getRecordName(row as Record<string, unknown>));
    if (!rowName) return { row };

    // 1. Exact match
    if (imageMap.has(rowName)) {
      const img = imageMap.get(rowName)!;
      log.info(`✓ MATCHED  name="${rowName}" → "${img}"`);
      return { row, matchedImage: img };
    }

    // 2. Substring match — handles extra tokens (middle names, initials, etc.)
    // Prefer exact over partial: try longest key that is a subset first
    let bestMatch: string | undefined;
    let bestMatchKey = '';
    for (const [key, originalFilename] of imageMap) {
      if (key && (rowName.includes(key) || key.includes(rowName))) {
        // Prefer the longer / more specific key
        if (key.length > bestMatchKey.length) {
          bestMatch = originalFilename;
          bestMatchKey = key;
        }
      }
    }
    if (bestMatch) {
      log.info(`~ PARTIAL  name="${rowName}" (key="${bestMatchKey}") → "${bestMatch}"`);
      return { row, matchedImage: bestMatch };
    }

    log.warn(`✗ UNMATCHED  name="${rowName}" — no image found`);
    return { row };
  });
}

/**
 * Bulk-replace all DataRecords for a project + category with the enriched rows.
 *
 * Uses `deleteMany` + `insertMany` (same semantic as POST /api/projects/:id/records)
 * so that a re-import always produces a clean, consistent dataset.
 *
 * `insertMany({ ordered: false })` allows partial inserts — if one document
 * fails validation the rest are still saved and the error is reported.
 */
export async function saveDataRecords(
  projectId: string,
  category:  string,
  rows:      Record<string, string>[],
): Promise<SaveRecordsResult> {
  const errors: string[] = [];

  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new Error(`Invalid projectId: ${projectId}`);
  }

  const projectOid = new mongoose.Types.ObjectId(projectId);

  // Replace existing records for this project + category
  await DataRecord.deleteMany({ projectId: projectOid, category });

  if (rows.length === 0) {
    log.warn(`No rows to save for project=${projectId} category=${category}`);
    return { saved: 0, errors };
  }

  const docs = rows.map((variables) => ({
    projectId: projectOid,
    category,
    variables,
    status: 'pending' as const,
  }));

  try {
    await DataRecord.insertMany(docs, { ordered: false });
    log.info(`Saved ${docs.length} DataRecords — project=${projectId} category=${category}`);
    return { saved: docs.length, errors };
  } catch (err: unknown) {
    // insertMany with ordered:false may partially succeed (BulkWriteError)
    const bulkErr = err as { result?: { insertedCount?: number }; message?: string };
    const saved   = bulkErr?.result?.insertedCount ?? 0;
    const failed  = docs.length - saved;
    const msg     = bulkErr?.message ?? String(err);
    errors.push(`Partial insert: ${failed} of ${docs.length} records failed — ${msg}`);
    log.error(`DataRecord partial insert failure: ${msg}`);
    return { saved, errors };
  }
}
