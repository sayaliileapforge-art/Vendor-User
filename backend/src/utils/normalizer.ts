/**
 * Name and filename normalisation utilities shared across the upload pipeline
 * and the BullMQ worker so matching logic is consistent everywhere.
 *
 * The same functions exist inline in the original uploads.ts route; they are
 * extracted here so the worker can reuse them without code duplication.
 */

import path from 'path';

/**
 * Core normaliser: lowercase, keep only a–z and 0–9, drop everything else
 * (spaces, underscores, hyphens, apostrophes, dots, …).
 *
 * Examples:
 *   "Vanshika Katiyar" → "vanshikakatiyar"
 *   "O'Brien"          → "obrien"
 *   "ravi_kumar"       → "ravikumar"
 */
export function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Extract a normalised key from an image filename for name-based matching.
 *
 * Steps:
 *  1. Decode URL encoding (e.g. %20 → space, so "Avni%20Pal" stays "Avni Pal")
 *  2. Strip file extension
 *  3. Strip ALL leading roll-number / serial prefixes (digits + optional separator)
 *     Handles multi-segment prefixes like "145_36_" in "145_36_Avni_Pal.jpg"
 *  4. Run normalize()
 *
 * Examples:
 *   "145_36_Avni%20Pal_.jpg"    → "avnipal"
 *   "145_36_avni_pal.jpg"       → "avnipal"
 *   "145_Vanshika_Katiyar.jpg"  → "vanshikakatiyar"
 *   "145__vanshika_katiyar.jpg" → "vanshikakatiyar"
 *   "12_Ravi_Kumar.jpeg"        → "ravikumar"
 *   "vanshika_katiyar.jpg"      → "vanshikakatiyar"
 */
export function normalizeFilename(filename: string): string {
  // Step 1: decode URL-encoded characters (e.g. %20 → space)
  let decoded = filename;
  try { decoded = decodeURIComponent(filename); } catch { /* keep original on malformed % */ }

  const noExt = path.basename(decoded, path.extname(decoded));
  // Step 3: strip ALL leading roll/serial number segments, e.g. "145_36_" or "12__" or "2024-01_"
  // The + quantifier on the group repeats until no more digit-prefix segments remain.
  const noPrefix = noExt.replace(/^(\d+[_\s.\-]*)+/, '');
  return normalize(noPrefix);
}

/**
 * Extract a normalised student/record name from a DataRecord variables object.
 * Checks common column name variations (CSV headers vary by school).
 * Falls back to case-insensitive key search for headers like "STUDENT NAME".
 */
export function getRecordName(vars: Record<string, unknown>): string {
  // Fast path: exact key match
  const direct = String(
    vars['Name']          ??
    vars['name']          ??
    vars['StudentName']   ??
    vars['studentName']   ??
    vars['student_name']  ??
    vars['FullName']      ??
    vars['fullName']      ??
    vars['full_name']     ??
    vars['Student Name']  ??
    vars['student name']  ??
    vars['STUDENT NAME']  ??
    vars['Full Name']     ??
    '',
  ).trim();
  if (direct) return direct.toLowerCase();

  // Fallback: case-insensitive scan for any key that looks like a name field
  const namePattern = /^(student\s*name|full\s*name|name)$/i;
  for (const [key, val] of Object.entries(vars)) {
    if (namePattern.test(key.trim()) && val) return String(val).trim().toLowerCase();
  }
  return '';
}
