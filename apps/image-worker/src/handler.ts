import { fileURLToPath } from "node:url";
import { GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  type DrmBinaries,
  loadQrReader,
  packageDrmClip,
  verifyDrmBinaries,
} from "@daybell/image-pipeline";
import { s3PhotoStorage } from "@daybell/storage";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { configFromEnv, createHandler, type KmsLike, kmsDataKey, secretsFromJson } from "./worker";

/**
 * The Lambda's entry point (lib/index.handler in the zip). Credentials come from the function's execution role, which
 * may only read originals and write previews in its own bucket, read its one secret, and (DRM, ADR 0034) ask the DRM
 * KMS key for data keys with an encryption context (docs/aws-staging-photos.md).
 * The signing secret is read from Secrets Manager once per cold start; it is never in the function's environment.
 */
let handle: ((event: SQSEvent) => Promise<SQSBatchResponse>) | null = null;

/** zxing's reader, copied next to the bundle by scripts/build.mjs (lib/zxing_reader.wasm), never fetched (ADR 0018). */
const qrWasmFile = () => fileURLToPath(new URL("./zxing_reader.wasm", import.meta.url));

/**
 * The build's check that the bundle can read QR cards: the wasm file next to it loads and reads an empty image. Not
 * called by Lambda.
 */
export async function qrSelfCheck(): Promise<number> {
  const read = await loadQrReader(qrWasmFile());
  return (await read({ data: new Uint8Array(4 * 16 * 16), width: 16, height: 16 })).length;
}

/**
 * The DRM tools from the Lambda layer (apps/image-worker/layer; ADR 0034), mounted at /opt. Their SHA-256 is checked
 * against the pins in @daybell/image-pipeline before the first use in each cold start.
 */
export const DRM_LAYER_BINARIES: DrmBinaries = {
  ffmpeg: "/opt/bin/ffmpeg",
  packager: "/opt/bin/packager",
};

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
      qrWasmFile: qrWasmFile(),
      ...(env.drmKmsKeyArn
        ? {
            drm: {
              dataKey: kmsDataKey(
                new KMSClient({ region: "ca-central-1" }) as unknown as KmsLike,
                env.drmKmsKeyArn,
                (input) => new GenerateDataKeyCommand(input),
              ),
              packageClip: async (frame, keyId, key) => {
                await verifyDrmBinaries(DRM_LAYER_BINARIES);
                return packageDrmClip({ frame, keyId, key, binaries: DRM_LAYER_BINARIES });
              },
            },
          }
        : {}),
    });
  }
  return handle(event);
}
