# Staging photo storage on AWS (Phase 1 step 4)

What Seenu sets up once in the AWS console, in **ca-central-1 (Canada Central)**, for staging photo uploads and
previews (ADR 0016; D39, D53, D60, D100, D113). Replace `<account-id>` with the AWS account's 12-digit id. Nothing
here goes in the repository: secrets live in Vercel, AWS and GitHub only, and are never pasted into chat.

Already done: bucket `daybell-staging-ca-photos` (Block Public Access on) and Vercel's OIDC role
`daybell-staging-vercel` (env `AWS_ROLE_ARN`, `AWS_REGION=ca-central-1`).

## 1. Bucket properties

S3 › `daybell-staging-ca-photos` › **Properties**:
- **Bucket Versioning**: Edit › Enable › Save.
- **Default encryption**: check it says SSE-S3 (Amazon S3 managed keys). Leave Bucket Key as is.

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
      "https://daybell-*.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Browsers PUT parts straight to the bucket from these addresses. If staging gets its own domain, add it here.

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

## 6. IAM role for the worker

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
      "Resource": "arn:aws:s3:::daybell-staging-ca-photos/*.webp"
    },
    {
      "Sid": "MissingObjectsAre404",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::daybell-staging-ca-photos"
    },
    {
      "Sid": "PhotoEvents",
      "Effect": "Allow",
      "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
      "Resource": "arn:aws:sqs:ca-central-1:<account-id>:daybell-staging-ca-photo-events"
    }
  ]
}
```

The worker can read originals and write previews in this bucket only; it can't delete anything or reach the database.

## 7. The Lambda function

Lambda › Create function › **Author from scratch**:
- Name **`daybell-staging-ca-image-worker`**; Runtime **Node.js 22.x**; Architecture **arm64**.
- Execution role: **Use an existing role** › `daybell-staging-ca-image-worker`. Create.

Then, on the function:
- **Code** › Runtime settings › Edit › Handler **`lib/index.handler`**. Save. (The code itself arrives with the
  GitHub workflow in step 9.)
- **Configuration › General configuration** › Edit: Memory **2048 MB**, Ephemeral storage **512 MB**, Timeout **1 min
  0 sec**. Save.
- **Configuration › Concurrency** › Edit › Reserve concurrency **10**. Save.
- **Configuration › Environment variables** › Edit, add (names below; values from you, never in the repo):
  - `CALLBACK_BASE_URL`: `https://daybell-git-main-artona-tech-team.vercel.app`
  - `PHOTO_WORKER_SECRET`: a new secret, made with `openssl rand -base64 32`. The same value goes in Vercel's
    `PHOTO_WORKER_SECRETS` (step 10).
  - `VERCEL_PROTECTION_BYPASS`: Vercel's Protection Bypass for Automation secret (step 10), if deployment protection
    is on.
  - `DATA_REGION`: `ca`
  - `PHOTO_BUCKET`: `daybell-staging-ca-photos`
- **Configuration › Triggers** › Add trigger › **SQS** › `daybell-staging-ca-photo-events`; Batch size **1**; tick
  **Report batch item failures**; Activate trigger. Add.
- **Configuration › Monitoring and operations tools** › Logging: open the CloudWatch log group
  `/aws/lambda/daybell-staging-ca-image-worker` › Actions › Edit retention setting › **1 month (30 days)**.

CloudWatch › Alarms › Create alarm › Select metric › SQS › Queue Metrics › `daybell-staging-ca-photo-dlq` ›
**ApproximateNumberOfMessagesVisible**; Statistic Maximum, Period 5 minutes; **Greater than 0**; notify Seenu's
email (an SNS topic). Name `daybell-staging-photo-dlq`. A message there is a photo whose previews couldn't be made
after five tries; it shows as Processing in the app, and Try again works after 15 minutes.

## 8. Vercel's role (`daybell-staging-vercel`)

IAM › Roles › `daybell-staging-vercel` › its existing photo policy › Edit › add these statements (the existing Put
already covers starting, uploading parts of and completing an upload):

```json
[
  {
    "Sid": "PurgeVersions",
    "Effect": "Allow",
    "Action": ["s3:ListBucketVersions"],
    "Resource": "arn:aws:s3:::daybell-staging-ca-photos"
  },
  {
    "Sid": "PurgeVersionObjects",
    "Effect": "Allow",
    "Action": ["s3:DeleteObjectVersion"],
    "Resource": "arn:aws:s3:::daybell-staging-ca-photos/*"
  },
  {
    "Sid": "RetryPhotos",
    "Effect": "Allow",
    "Action": ["sqs:SendMessage"],
    "Resource": "arn:aws:sqs:ca-central-1:<account-id>:daybell-staging-ca-photo-events"
  }
]
```

## 9. Deploying the worker from GitHub

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
          "token.actions.githubusercontent.com:sub": "repo:seenu-artona/daybell:environment:staging"
        }
      }
    }
  ]
}
```

Next (no managed policies) › Name **`daybell-staging-github-image-worker-deploy`** › Create. Then add an inline
policy `deploy-image-worker`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"],
      "Resource": "arn:aws:lambda:ca-central-1:<account-id>:function:daybell-staging-ca-image-worker"
    }
  ]
}
```

GitHub › the repository › Settings › **Environments** › New environment **`staging`**:
- **Required reviewers**: Seenu. **Deployment branches**: Selected branches › `main`.
- **Environment variables** › Add `AWS_IMAGE_WORKER_DEPLOY_ROLE_ARN` = the role's ARN (not a secret).

To deploy: Actions › **Deploy image worker (staging)** › Run workflow (branch `main`) › approve. It tests, builds the
zip (sharp for Linux arm64) and updates the function's code. Run it once now, after merging, so the function has code.

## 10. Vercel (staging)

Project › Settings › Environment Variables, for the staging environment. Names only here; the values come from the
steps above or are new secrets:

| Name | What |
|---|---|
| `STORAGE_DRIVER` | `s3` |
| `PHOTO_BUCKET_CA` | the bucket's name |
| `PHOTO_QUEUE_URL_CA` | the photo-events queue's URL (step 4) |
| `PHOTO_WORKER_SECRETS` | the worker's secret (step 7); during a rotation, the new and the old, comma-separated |
| `CRON_SECRET` | a new secret, `openssl rand -base64 32`; Vercel sends it to the daily clean-up |
| `AWS_ROLE_ARN`, `AWS_REGION` | already set (`ca-central-1`) |

Project › Settings › **Deployment Protection** › **Protection Bypass for Automation** › create a secret if protection
is on; it is the Lambda's `VERCEL_PROTECTION_BYPASS` (step 7).

The daily clean-up is declared in `apps/web/vercel.json` (07:17 UTC). Vercel runs cron jobs only for **production**
deployments, and only when `apps/web` is the project's Root Directory; if staging is a preview deployment, the
clean-up must be triggered another way (follow-up). Redeploy after adding the variables.

## Rotating the worker's secret

1. Add the new secret to Vercel's `PHOTO_WORKER_SECRETS` after the old one (`old,new`) and redeploy.
2. Change the Lambda's `PHOTO_WORKER_SECRET` to the new one.
3. Remove the old one from Vercel and redeploy.
