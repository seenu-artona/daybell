import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ABANDONED_UPLOAD_DAYS,
  BIN_DAYS,
  IDLE_BATCH_HOURS,
  MAX_FILES_PER_REQUEST,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_BIN_REQUEST,
  MAX_PHOTOS_PER_JOB,
} from "@daybell/core";
import { describe, expect, it } from "vitest";

// The photo limits live in core for screens and the API, and in the database's functions; this keeps them the same
// (review CR14). It reads the migration as text.
const sql = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    "db",
    "supabase",
    "migrations",
    "20261011100000_photos.sql",
  ),
  "utf8",
);

describe("photo limits match the database", () => {
  it("bin, abandoned uploads and idle batches", () => {
    expect(sql).toContain(`interval '${BIN_DAYS} days'`);
    expect(sql).toContain(`interval '${ABANDONED_UPLOAD_DAYS} days'`);
    expect(sql).toContain(`interval '${IDLE_BATCH_HOURS} hours'`);
  });
  it("sizes and counts", () => {
    expect(sql).toContain(`byte_size between 1 and ${MAX_PHOTO_BYTES}`);
    expect(sql).toContain(`> ${MAX_PHOTOS_PER_JOB}`);
    expect(sql).toContain(`not between 1 and ${MAX_FILES_PER_REQUEST}`);
    expect(sql).toContain(
      `cardinality(p_photo_ids), 0) not between 1 and ${MAX_PHOTOS_PER_BIN_REQUEST}`,
    );
  });
});
