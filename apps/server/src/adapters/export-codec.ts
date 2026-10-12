/**
 * gzip for `.uniwake` files (ADR-049). Inflating stops at `maxBytes`, so a small hostile file
 * cannot expand into gigabytes of memory.
 */
import { constants, gunzipSync, gzipSync } from 'node:zlib';
import type { ExportCodec } from '../application/migration/export-service';

export const exportCodec: ExportCodec = {
  compress: (json) => gzipSync(json, { level: constants.Z_BEST_COMPRESSION }),
  decompress: (bytes, maxBytes) => gunzipSync(bytes, { maxOutputLength: maxBytes }),
};
