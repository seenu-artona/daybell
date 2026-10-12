import { S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { s3PhotoStorage } from "@daybell/storage";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { configFromEnv, createHandler, secretsFromJson } from "./worker";

/**
 * The Lambda's entry point (lib/index.handler in the zip). Credentials come from the function's execution role, which
 * may only read originals and write previews in its own bucket, and read its one secret (docs/aws-staging-photos.md).
 * The signing secret is read from Secrets Manager once per cold start; it is never in the function's environment.
 */
let handle: ((event: SQSEvent) => Promise<SQSBatchResponse>) | null = null;

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  if (!handle) {
    const env = configFromEnv(process.env);
    const secrets = new SecretsManagerClient({ region: "ca-central-1" });
    const value = await secrets.send(new GetSecretValueCommand({ SecretId: env.secretArn }));
    const { secret, protectionBypass } = secretsFromJson(value.SecretString);
    const client = new S3Client({
      region: "ca-central-1",
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    handle = createHandler({
      config: {
        callbackBaseUrl: env.callbackBaseUrl,
        region: env.region,
        bucket: env.bucket,
        secret,
        ...(protectionBypass ? { protectionBypass } : {}),
      },
      storage: s3PhotoStorage({ client, bucket: env.bucket }),
    });
  }
  return handle(event);
}
