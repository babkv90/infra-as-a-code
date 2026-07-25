# Storage modes

`STORAGE_MODE` (in `.env`) selects the `StorageAdapter` used for uploaded artifacts (see
`src/storage/`). It's read once at startup — nothing else in the codebase branches on it directly.

- **`local`** (default) — reads/writes `IAAS backend/.terraform-runs` on disk. No AWS calls, no
  extra config needed.
- **`s3`** — reads/writes a real S3 bucket. Requires `STORAGE_S3_BUCKET`; `STORAGE_S3_REGION` falls
  back to `AWS_REGION` if unset. The bucket (and, once state is wired up, the DynamoDB lock table
  named by `STORAGE_DYNAMODB_LOCK_TABLE`) must already exist — this app does not create them.

## Testing `s3` mode locally

Point a local run at a real (ideally scratch/throwaway) bucket before trusting it in production:

```
STORAGE_MODE=s3
STORAGE_S3_BUCKET=your-scratch-test-bucket
STORAGE_S3_REGION=ap-south-1
```

The AWS identity in `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (already required for the
Terraform runner) needs `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, and `s3:ListBucket` on
that bucket. Run the app as normal (`npm run dev`) — every artifact read/write now goes to S3
instead of local disk; nothing else about the request/response behavior changes.

## Current scope

As of now, `StorageAdapter` covers artifact storage only (`writeFile`/`readFile`/`deleteFile`/
`exists`/`resolveArtifactReference`). It is not yet wired into `terraformGenerator.js` (the
`filename`/`s3_bucket`+`s3_key` Lambda argument choice), the Terraform `backend` block, or
`terraformDeploymentRunner.js`'s cleanup behavior — that wiring is a deliberate next step, pending
design sign-off, not an oversight.
