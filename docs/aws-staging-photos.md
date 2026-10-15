# Staging photo storage on AWS (Phase 1 step 4)

What Seenu sets up once in the AWS console, in **ca-central-1 (Canada Central)**, for staging photo uploads and
previews (ADR 0016; D39, D53, D60, D100, D113). Replace `<account-id>` with the AWS account's 12-digit id. Nothing
here goes in the repository: secrets live in AWS Secrets Manager, Vercel and GitHub only, and are never pasted into
chat.

Already done: bucket `daybell-staging-ca-photos` (Block Public Access on) and Vercel's OIDC role
`daybell-staging-vercel` (env `AWS_ROLE_ARN`, `AWS_REGION=ca-central-1`).

## 1. Bucket properties

S3 › `daybell-staging-ca-photos` › **Properties**:
- **Bucket Versioning**: Edit › Enable › Save.
- **Default encryption**: check it says SSE-S3 (Amazon S3 managed keys). Leave Bucket Key as is.

**Permissions** › Bucket policy › Edit, paste (refuses anything not over HTTPS):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "HttpsOnly",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::daybell-staging-ca-photos",
        "arn:aws:s3:::daybell-staging-ca-photos/*"
      ],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    }
  ]
}
```

## 2. Lifecycle rule

**Management** › Create lifecycle rule:
- Name `photos`; scope: **Apply to all objects in the bucket** (tick the acknowledgement).
- Actions: tick **Permanently delete noncurrent versions of objects** (30 days after objects become noncurrent;
  leave "number of newer versions to retain" empty), **Delete expired object delete markers or incomplete multipart
  uploads** › tick both **Delete expired object delete markers** and **Delete incomplete multipart uploads** (7 days).
- No storage-class transitions yet (they wait for the job's archive date, D85).
- Create rule.

## 3. CORS

**Permissions** › Cross-origin resource sharing (CORS) › Edit, paste:

```json
[
  {
    "AllowedOrigins": [
      "https://daybell-git-main-artona-tech-team.vercel.app",
      "https://daybell-*-artona-tech-team.vercel.app"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Browsers PUT parts straight to the bucket from staging and the team's preview deployments only. Local development
uses the local driver and never talks to S3. If staging gets its own domain, add it here.

## 4. SQS queues

SQS › Create queue, twice:

1. **`daybell-staging-ca-photo-dlq`**: Standard; Message retention period **14 days**; Encryption: **SSE-SQS**.
   Create.
2. **`daybell-staging-ca-photo-events`**: Standard; Visibility timeout **6 minutes**; Message retention period
   **4 days**; Encryption **SSE-SQS**; Dead-letter queue: **Enabled**, choose `daybell-staging-ca-photo-dlq`, Maximum
   receives **5**. Access policy: **Advanced**, paste (S3 may send messages from this bucket only):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3PhotoEvents",
      "Effect": "Allow",
      "Principal": { "Service": "s3.amazonaws.com" },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:ca-central-1:<account-id>:daybell-staging-ca-photo-events",
      "Condition": {
        "ArnLike": { "aws:SourceArn": "arn:aws:s3:::daybell-staging-ca-photos" },
        "StringEquals": { "aws:SourceAccount": "<account-id>" }
      }
    }
  ]
}
```

   Create. Copy its **URL** (for Vercel's `PHOTO_QUEUE_URL_CA`, step 10).

## 5. S3 event notification

S3 › `daybell-staging-ca-photos` › **Properties** › Event notifications › Create event notification:
- Name `photo-originals`; Prefix empty; **Suffix `/original`**.
- Event types: **All object create events**.
- Destination: **SQS queue** › `daybell-staging-ca-photo-events`. Save. (S3 sends a test event first; the worker
  ignores it.)

## 6. The worker's secret

Make a new signing secret on your own computer: `openssl rand -base64 32`.

Secrets Manager (ca-central-1) › Store a new secret › **Other type of secret** › Plaintext, paste (with your values):

```json
{ "photoWorkerSecret": "<the new secret>", "vercelProtectionBypass": "<Vercel's bypass secret, step 10; leave out if protection is off>" }
```

Encryption key: `aws/secretsmanager`. Next › Name **`daybell-staging-ca-image-worker`** › Next › no rotation › Store.
Copy the secret's **ARN**. The same `photoWorkerSecret` goes in Vercel's `PHOTO_WORKER_SECRETS` (step 10).

## 7. IAM role for the worker

IAM › Roles › Create role › AWS service › **Lambda** › Next:
- Attach the managed policy **AWSLambdaBasicExecutionRole**. Next. Name **`daybell-staging-ca-image-worker`**. Create.
- Open the role › Add permissions › Create inline policy › JSON, paste, name it `photos`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOriginals",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::daybell-staging-ca-photos/*/original"
    },
    {
      "Sid": "WritePreviews",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": [
        "arn:aws:s3:::daybell-staging-ca-photos/*.webp",
        "arn:aws:s3:::daybell-staging-ca-photos/*/download.jpg"
      ]
    },
    {
      "Sid": "SizesByListing",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::daybell-staging-ca-photos"
    },
    {
      "Sid": "PhotoEvents",
      "Effect": "Allow",
      "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
      "Resource": "arn:aws:sqs:ca-central-1:<account-id>:daybell-staging-ca-photo-events"
    },
    {
      "Sid": "ItsOneSecret",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "<the secret's ARN from step 6>"
    }
  ]
}
```

The worker can read originals and write previews and paid downloads (`download.jpg`, since step 10) in this bucket
only, and read its one secret; it can't delete anything or reach the database.

## 8. The Lambda function

Lambda › Create function › **Author from scratch**:
- Name **`daybell-staging-ca-image-worker`**; Runtime **Node.js 22.x**; Architecture **arm64**.
- Execution role: **Use an existing role** › `daybell-staging-ca-image-worker`. Create.

Then, on the function:
- **Code** › Runtime settings › Edit › Handler **`lib/index.handler`**. Save. (The code itself arrives with the
  GitHub workflow in step 11.)
- **Configuration › General configuration** › Edit: Memory **2048 MB**, Ephemeral storage **512 MB**, Timeout **1 min
  0 sec**. Save.
- Concurrency: don't reserve any. A new account's limit is 10 and AWS keeps 10 unreserved, so a reservation is
  refused. The trigger's **Maximum concurrency** (below) caps the worker at 5 instead.
- **Configuration › Environment variables** › Edit, add (no secrets here; they are in Secrets Manager):
  - `CALLBACK_BASE_URL`: `https://daybell-git-main-artona-tech-team.vercel.app`
  - `PHOTO_WORKER_SECRETS_ARN`: the secret's ARN (step 6)
  - `DATA_REGION`: `ca`
  - `PHOTO_BUCKET`: `daybell-staging-ca-photos`
- **Configuration › Triggers** › Add trigger › **SQS** › `daybell-staging-ca-photo-events`; Batch size **1**; Maximum
  concurrency **5**; tick **Report batch item failures**; Activate trigger. Add.
- **Configuration › Monitoring and operations tools** › Logging: open the CloudWatch log group
  `/aws/lambda/daybell-staging-ca-image-worker` › Actions › Edit retention setting › **1 month (30 days)**.

CloudWatch › Alarms › Create alarm › Select metric › SQS › Queue Metrics › `daybell-staging-ca-photo-dlq` ›
**ApproximateNumberOfMessagesVisible**; Statistic Maximum, Period 5 minutes; **Greater than 0**; notify Seenu's
email (an SNS topic). Name `daybell-staging-photo-dlq`. A message there is a photo whose previews couldn't be made
after five tries; it shows as Processing in the app, and Try again appears after 15 minutes.

## 9. Vercel's role (`daybell-staging-vercel`)

IAM › Roles › `daybell-staging-vercel`:

**Trust relationships**: check the condition on Vercel's OIDC `sub` names this team, this project and the staging
environment (Vercel's format: `owner:<team>:project:<project>:environment:<environment>`), and the `aud` is the
team's, so no other Vercel project or environment can assume the role.

**Permissions**: replace its photo policy with this one. The web app never reads originals: it reads previews only,
and finds sizes by listing.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UploadOriginals",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": "arn:aws:s3:::daybell-staging-ca-photos/*/original"
    },
    {
      "Sid": "ReadPreviewsOnly",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::daybell-staging-ca-photos/*/thumb.webp",
        "arn:aws:s3:::daybell-staging-ca-photos/*/view.webp",
        "arn:aws:s3:::daybell-staging-ca-photos/*/proof*.webp"
      ]
    },
    {
      "Sid": "ListAndPurge",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketVersions"],
      "Resource": "arn:aws:s3:::daybell-staging-ca-photos"
    },
    {
      "Sid": "PurgeVersions",
      "Effect": "Allow",
      "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion"],
      "Resource": "arn:aws:s3:::daybell-staging-ca-photos/*"
    },
    {
      "Sid": "RetryPhotos",
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:ca-central-1:<account-id>:daybell-staging-ca-photo-events"
    }
  ]
}
```

## 10. Vercel (staging)

Project › Settings › Environment Variables, for the staging environment. Names only here; the values come from the
steps above or are new secrets:

| Name | What |
|---|---|
| `STORAGE_DRIVER` | `s3` |
| `PHOTO_BUCKET_CA` | the bucket's name |
| `PHOTO_QUEUE_URL_CA` | the photo-events queue's URL (step 4) |
| `PHOTO_WORKER_SECRETS` | the worker's `photoWorkerSecret` (step 6); during a rotation, the new and the old, comma-separated |
| `CRON_SECRET` | a new secret, `openssl rand -base64 32`; the daily clean-up's bearer token |
| `AWS_ROLE_ARN`, `AWS_REGION` | already set (`ca-central-1`) |

Project › Settings › **Deployment Protection** › **Protection Bypass for Automation** › create a secret if protection
is on; it goes in the worker's secret (step 6) and GitHub (step 12). Redeploy after adding the variables.

## 11. Deploying the worker from GitHub

IAM › Identity providers › Add provider (once per account) › **OpenID Connect**: Provider URL
`https://token.actions.githubusercontent.com`, Audience `sts.amazonaws.com`. Add.

IAM › Roles › Create role › **Custom trust policy**, paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:seenu-artona@292234898/daybell@1413886255:environment:staging"
        }
      }
    }
  ]
}
```

GitHub's `sub` for repositories created after July 15, 2026 includes the owner and repository ids
(`owner@id/repo@id`); this repository was created on Oct 11, 2026, so the old `repo:seenu-artona/daybell:…` form is
refused. The ids come from `GET /repos/seenu-artona/daybell` (`owner.id`, `id`).

Next (no managed policies) › Name **`daybell-staging-github-image-worker-deploy`** › Create. Then add an inline
policy `deploy-image-worker`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode", "lambda:GetFunction"],
      "Resource": "arn:aws:lambda:ca-central-1:<account-id>:function:daybell-staging-ca-image-worker"
    }
  ]
}
```

GitHub › the repository › Settings › **Environments** › New environment **`staging`**:
- **Required reviewers**: Seenu, where the plan offers it (private repositories on GitHub's free plan don't; then the
  deploy runs only when someone with write access starts it by hand). **Deployment branches**: Selected branches ›
  `main`.
- **Environment variables** › Add `AWS_IMAGE_WORKER_DEPLOY_ROLE_ARN` = the role's ARN (not a secret).

To deploy: Actions › **Deploy image worker (staging)** › Run workflow (branch `main`). The `build` job tests and
packages the zip with no AWS access; after Seenu approves, the `deploy` job uploads it. Run it once now, after merging,
so the function has code.

## 12. The daily clean-up

`apps/web/vercel.json` schedules the clean-up (07:17 UTC), but Vercel runs cron jobs only for production deployments.
For staging, the **Staging photo clean-up** GitHub workflow calls it daily at the same time. GitHub › Settings ›
Secrets and variables › Actions › **Repository secrets**:
- `STAGING_CRON_SECRET`: the same value as Vercel's `CRON_SECRET`.
- `STAGING_VERCEL_PROTECTION_BYPASS`: Vercel's bypass secret, if deployment protection is on.

Run it once by hand (Actions › Staging photo clean-up › Run workflow) to check it answers with counts.

## 13. Paid downloads (step 10)

Since step 10 the worker also makes a **sold** photo's **paid download**, `download.jpg`: the original at full
resolution, upright, sRGB, with every other bit of metadata stripped (ADR 0023, Claude's call 10). It is made lazily,
only once the photo is sold (security review N1): never while a photo is processed, so an unwatermarked
full-resolution copy exists only for photos a parent paid for. Parents get a 5-minute link to it after paying; never to
the original. Signing those links needs read access to full-resolution files, which the app's
usual role (`daybell-staging-vercel`) must still never have, so a **second role** signs them and can read
`*/download.jpg` and nothing else.

1. **The worker writes `download.jpg`.** Update the worker role's inline policy `photos` as in step 7 (the
   `WritePreviews` statement now lists `*/download.jpg` too). Then run the deploy workflow (step 11) once this step is
   merged, so the worker has the new code.
2. **The download role.** IAM › Roles › Create role › **Custom trust policy**: copy the trust policy of
   `daybell-staging-vercel` exactly (the same Vercel OIDC provider, and the same `aud` and `sub` conditions naming this
   team, project and staging environment; step 9). Next (no managed policies) › Name
   **`daybell-staging-ca-photo-downloads`** › Create. Add an inline policy `downloads`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "ReadPaidDownloadsOnly",
         "Effect": "Allow",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::daybell-staging-ca-photos/*/download.jpg"
       }
     ]
   }
   ```

   Don't add `download.jpg` to `daybell-staging-vercel`'s policy.
3. **Vercel.** Add `AWS_DOWNLOAD_ROLE_ARN` = the new role's ARN, for the staging environment (not a secret). It must
   differ from `AWS_ROLE_ARN`; the app refuses to sign download links otherwise. The photo-events queue is unchanged:
   the existing `RetryPhotos` permission (step 9) is what sends the backfill messages below. Redeploy.
4. **How the file gets made.** Nothing to run by hand. When an order is paid, Daybell queues `{photoId, make:
   "download"}` on the photo-events queue for each photo it sold (the photo's id only); the worker makes just that file.
   If a parent opens a paid download before it exists, Daybell asks them to try again in about 20 seconds, and queues
   the photo again only if it was last asked for over 5 minutes ago. After 3 requests without the file, the parent is
   told the download isn't available and the app logs `download_unavailable` (look at the worker's logs for
   `download_failed` or `download_skipped` with the photo's id).
5. **Check.** Buy a download on staging (`docs/stripe-staging.md`, section 6) and open it: the file saves as
   `daybell-<reference>-1.jpg`. In S3, the photo's folder has `download.jpg` with `Cache-Control: private, no-store`.

The lifecycle rule and the daily clean-up already cover `download.jpg` with the rest of the photo's files.

## 14. DRM in the parent shop's large view (round 8; ADR 0034)

Since round 8 the worker also packages each ready photo's **large view for DRM**: its watermarked `proof.webp` as a
2-second encrypted clip, stored in the photo's `drm/` folder under the key's own ID (`drm/<key id>.mp4`, `.mpd`,
`.m3u8`, `-video.m3u8`), one content key per photo made by **KMS in ca-central-1** and stored only wrapped. The shop
shows it only while the database switch is on for the studio (off by default, step 14.9). Nothing here is needed for
the rest of the app; do the steps in this order.

**Staging only.** Every setting below goes in Vercel's **Production** environment (staging today), never Preview.
**Never widen `daybell-staging-vercel`'s or `daybell-staging-ca-drm`'s trust to Preview deployments**: a Preview build
of any branch would then unwrap photo keys. The device matrix runs on staging, switched on for Seenu's own test studio
only (14.9).

### 14.1 The KMS key and its policy

KMS (ca-central-1) › Customer managed keys › **Create key**:
- Key type **Symmetric**; Key usage **Encrypt and decrypt**; Advanced options: Key material origin **KMS**,
  **Single-Region key**. Next.
- Alias **`daybell-staging-ca-drm`**; description "Wraps each photo's DRM content key (ADR 0034)". Next.
- Key administrators: Seenu only. Key users: **none**. Next › Finish.
- Open the key › copy its **key ARN** (`arn:aws:kms:ca-central-1:<account-id>:key/<uuid>`). The settings need this key
  ARN, not the alias: the app compares every wrapped key's KMS key with it.
- Key rotation: tick **Automatically rotate this KMS key** (yearly). Old wrapped keys still unwrap.
- **Key policy** › Edit, replace with (create the two roles of 14.2 and 14.5 first, or come back to this). The account
  can administer the key but not use it; only the worker makes keys and only the DRM role unwraps them, each with the
  photo's encryption context:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AccountAdministersOnly",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<account-id>:root" },
      "Action": [
        "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*", "kms:Revoke*",
        "kms:Disable*", "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource",
        "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion", "kms:RotateKeyOnDemand"
      ],
      "Resource": "*"
    },
    {
      "Sid": "OnlyTheWorkerMakesKeys",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<account-id>:role/daybell-staging-ca-image-worker" },
      "Action": "kms:GenerateDataKey",
      "Resource": "*",
      "Condition": {
        "ForAllValues:StringEquals": { "kms:EncryptionContextKeys": ["studio", "photo", "key"] },
        "Null": { "kms:EncryptionContextKeys": "false" }
      }
    },
    {
      "Sid": "OnlyTheDrmRoleUnwraps",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<account-id>:role/daybell-staging-ca-drm" },
      "Action": "kms:Decrypt",
      "Resource": "*",
      "Condition": {
        "ForAllValues:StringEquals": { "kms:EncryptionContextKeys": ["studio", "photo", "key"] },
        "Null": { "kms:EncryptionContextKeys": "false" }
      }
    }
  ]
}
```

### 14.2 The worker: data keys, proofs and clips

IAM › Roles › `daybell-staging-ca-image-worker` › Add permissions › Create inline policy › JSON, name it `drm`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DataKeysBoundToAPhoto",
      "Effect": "Allow",
      "Action": "kms:GenerateDataKey",
      "Resource": "<the key ARN from 14.1>",
      "Condition": {
        "ForAllValues:StringEquals": { "kms:EncryptionContextKeys": ["studio", "photo", "key"] },
        "Null": { "kms:EncryptionContextKeys": "false" }
      }
    },
    {
      "Sid": "ReadProofs",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::daybell-staging-ca-photos/*/proof.webp"
    },
    {
      "Sid": "WriteClips",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::daybell-staging-ca-photos/*/drm/*"
    }
  ]
}
```

The worker never gets `kms:Decrypt`: it can make a key but never unwrap one.

### 14.3 The tools layer, published by the deploy workflow

IAM › Roles › `daybell-staging-github-image-worker-deploy` › its inline policy `deploy-image-worker` › Edit, replace
with (the configuration change is allowed only when every layer it sets is a version of the DRM tools layer):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"],
      "Resource": "arn:aws:lambda:ca-central-1:<account-id>:function:daybell-staging-ca-image-worker"
    },
    {
      "Effect": "Allow",
      "Action": "lambda:UpdateFunctionConfiguration",
      "Resource": "arn:aws:lambda:ca-central-1:<account-id>:function:daybell-staging-ca-image-worker",
      "Condition": {
        "ForAllValues:StringLike": {
          "lambda:Layer": "arn:aws:lambda:ca-central-1:<account-id>:layer:daybell-staging-ca-drm-tools:*"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": "lambda:PublishLayerVersion",
      "Resource": "arn:aws:lambda:ca-central-1:<account-id>:layer:daybell-staging-ca-drm-tools"
    },
    {
      "Effect": "Allow",
      "Action": "lambda:GetLayerVersion",
      "Resource": "arn:aws:lambda:ca-central-1:<account-id>:layer:daybell-staging-ca-drm-tools:*"
    }
  ]
}
```

Then, after round 8 is merged: Actions › **Deploy image worker (staging)** › Run workflow (branch `main`) with
**Publish the DRM tools layer** ticked, and approve. The `build` job makes the layer from its SHA-256 pins (ffmpeg
7.0.2 and Shaka Packager 3.9.3 for arm64, about 61 MB unzipped) with no AWS access; `deploy` publishes it as a new
version of `daybell-staging-ca-drm-tools`, attaches it to the function (keeping any other layer, replacing only an
earlier version of this one), then uploads the code. Later code-only deploys leave the box unticked; the layer stays.

### 14.4 The worker's setting

Lambda › `daybell-staging-ca-image-worker` › Configuration › Environment variables › Edit › add
**`DRM_KMS_KEY_ARN`** = the **key** ARN (14.1). Save. Until it is set, DRM tasks fail back to the queue (and, after
five, the dead-letter queue, whose alarm already exists: step 8).

### 14.5 The DRM role for the shop's token route

IAM › Roles › Create role › **Custom trust policy**: copy the trust policy of `daybell-staging-vercel` exactly (step 9:
the staging environment only; never Preview). Next (no managed policies) › Name **`daybell-staging-ca-drm`** ›
Create. Add an inline policy `unwrap-photo-keys`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UnwrapPhotoKeysOnly",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "<the key ARN from 14.1>",
      "Condition": {
        "ForAllValues:StringEquals": { "kms:EncryptionContextKeys": ["studio", "photo", "key"] },
        "Null": { "kms:EncryptionContextKeys": "false" }
      }
    }
  ]
}
```

Don't give `kms:Decrypt` to `daybell-staging-vercel` or `daybell-staging-ca-photo-downloads` (the key policy doesn't
allow them anyway): the app refuses to start DRM if `AWS_DRM_ROLE_ARN` equals either of their ARNs.

### 14.6 The web app's role reads the manifests, signs the clips and clears old ones

IAM › Roles › `daybell-staging-vercel` › its photo policy (step 9) › in **`ReadPreviewsOnly`**, add
`"arn:aws:s3:::daybell-staging-ca-photos/*/drm/*"` to `Resource`. The shop's manifest route reads the database key's
`.mpd`/`.m3u8` and signs 10-minute links to its `.mp4`; it never needs a key. When a photo is processed again, the app
deletes its earlier `drm/` files before asking for a new clip: the existing `PurgeVersions` permission covers that.
The `RetryPhotos` permission sends the `{photoId, make: "drm"}` messages (the cron sends them in batches of 10:
`sqs:SendMessage` covers `SendMessageBatch`).

### 14.7 CORS for the clip

S3 › `daybell-staging-ca-photos` › Permissions › CORS › Edit, replace with (adds Range and the byte-range headers the
players need; Safari plays the clip with `crossorigin="anonymous"`):

```json
[
  {
    "AllowedOrigins": [
      "https://daybell-git-main-artona-tech-team.vercel.app",
      "https://daybell-*-artona-tech-team.vercel.app"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3000
  }
]
```

### 14.8 Vercel (Production = staging only)

Project › Settings › Environment Variables, for **Production** only (never Preview, never Development):

| Name | What |
|---|---|
| `DRM_KMS_KEY_ARN_CA` | the **key** ARN (14.1), not the alias. Set, it turns packaging requests on (new results and the daily backfill) |
| `AWS_DRM_ROLE_ARN` | `daybell-staging-ca-drm`'s ARN (14.5) |
| `SHOP_DRM_COM_KEY_ID` | the shop's Axinom communication key ID (a GUID) |
| `SHOP_DRM_COM_KEY` | that communication key, base64 of 32 bytes. **Sensitive.** Never the test page's `AXINOM_COM_KEY` (refused) |
| `SHOP_DRM_LICENSE_PREFIX` | the tenant part of `https://<prefix>.drm-widevine-licensing.axprod.net/AcquireLicense` |
| `SHOP_DRM_FAIRPLAY_CERT` | optional: the FairPlay certificate's DER bytes as base64 (`base64 -w0 fairplay.der`); unset, Safari keeps the WebP |

The Axinom values come from Axinom's portal (B3: the plan, price and DPA are Seenu's to settle first; a separate
communication key from the spike's). Paste them straight into Vercel; never into a file, a commit or a chat. Redeploy.

### 14.9 The switch (database owner only), for one studio first

Off by default. In the Canadian Supabase project's SQL editor, find your own test studio's id, then switch DRM on for
it alone; parents of every other studio keep the watermarked WebP:

```sql
select id, name from public.studios where slug = '<your test studio slug>';
select public.set_shop_drm(true, 'Staging: device matrix on my test studio', array['<studio id>'::uuid]);
select public.set_shop_drm(true, 'Staging: every studio');   -- later: every studio (no list)
select public.set_shop_drm(false, 'Staging: off again');      -- off
select setting, old_value, new_value, note, changed_by, changed_at
from app.platform_settings_changes where setting in ('shop_drm_enabled', 'shop_drm_studio_ids') order by changed_at;
```

The API can't run `set_shop_drm`. While off for a studio (or while any setting above is missing), its large views
are the watermarked WebP, as before.

### 14.10 Check

1. Upload a few photos to the test studio's job (or wait for the daily backfill: up to 2,000 photos a day). In S3,
   each ready photo's folder gains `drm/<key id>.mp4`, `.mpd`, `.m3u8` and `-video.m3u8` with `Cache-Control:
   private, max-age=3600`. The worker's log has `drm_ready <photo id>`.
2. In SQL: `select drm_status, count(*) from public.photos group by 1;` shows `ready` growing.
3. Switch it on for the test studio (14.9) and run the device matrix (ADR 0034) on staging with that studio's codes:
   the large view should be black in screenshots and recordings on hardware-DRM devices and the watermarked WebP
   (Blackout on computers) everywhere else.
4. Look for `drm_failed`, `drm_unavailable`, `drm_queue_failed`, `drm_cleanup_failed`, `shop_drm_misconfigured`,
   `shop_drm_unwrap_failed`, `shop_drm_key_mismatch`, `shop_drm_manifest_mismatch`, `shop_drm_manifest_missing` and
   `shop_drm_rate_limited` in the logs: each names a photo id, a count, a reason or a variable only.
5. Retries are daily: a request with no answer for an hour is queued again by the next day's cron run, 3 messages in
   all.

## Rotating the worker's secret

1. Add the new secret to Vercel's `PHOTO_WORKER_SECRETS` after the old one (`old,new`) and redeploy.
2. Change `photoWorkerSecret` in the Secrets Manager secret, then run the deploy workflow (new code starts new
   instances, which read the secret afresh).
3. Remove the old one from Vercel and redeploy.
