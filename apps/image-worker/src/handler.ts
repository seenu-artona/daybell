import { S3Client } from "@aws-sdk/client-s3";
import { s3PhotoStorage } from "@daybell/storage";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { configFromEnv, createHandler } from "./worker";

/**
 * The Lambda's entry point (lib/index.handler in the zip). Credentials come from the function's execution role, which
 * may only read originals and write previews in its own bucket (docs/aws-staging-photos.md).
 */
let handle: ((event: SQSEvent) => Promise<SQSBatchResponse>) | null = null;

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  if (!handle) {
    const config = configFromEnv(process.env);
    const client = new S3Client({
      region: "ca-central-1",
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    handle = createHandler({ config, storage: s3PhotoStorage({ client, bucket: config.bucket }) });
  }
  return handle(event);
}
