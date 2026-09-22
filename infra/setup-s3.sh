#!/usr/bin/env bash
# Creates and configures the S3 bucket for museum media.  REVIEW BEFORE RUNNING — it creates
# billable AWS resources.  Requires AWS CLI v2 with credentials allowed to manage S3 (+ IAM).
# Idempotent: re-running updates policy/CORS and skips resources that already exist.
#
#   BUCKET=hbp-museum-media REGION=ap-south-1 APP_ORIGINS=https://your-app.vercel.app ./infra/setup-s3.sh
#
#   APP_ORIGINS  comma-separated origins allowed to PUT (presigned admin uploads); one "*" wildcard
#                per origin is allowed, e.g. https://your-app-*.vercel.app for preview deployments.
#                http://localhost:3000 is always included.  (APP_ORIGIN is accepted as an alias.)
#   IAM_USER     the app's IAM user (default <bucket>-app)
#   KEYS_FILE    when set, a NEW access key is created and written there as env lines (chmod 600)
#                instead of being printed; set CREATE_KEY=0 to skip key creation entirely.
#
# What it does:
#   1. creates the bucket (ACLs disabled / BucketOwnerEnforced, SSE-S3 encryption)
#   2. allows a PUBLIC-READ bucket policy for GET on objects (museum media is public content)
#      — alternative: keep the bucket private and front it with CloudFront + Origin Access Control
#        (see the note at the end), then set S3_PUBLIC_BASE_URL to the CloudFront domain
#   3. applies CORS (GET/HEAD from anywhere for WebGL/crossOrigin textures & video; PUT from the
#      app origins for presigned admin uploads)
#   4. creates a least-privilege IAM user for the app (Get/Head/Put/Delete objects + List, this
#      bucket only) and an access key
set -euo pipefail

BUCKET="${BUCKET:?set BUCKET (globally unique name)}"
REGION="${REGION:-ap-south-1}"
APP_ORIGINS="${APP_ORIGINS:-${APP_ORIGIN:?set APP_ORIGINS, e.g. https://your-app.vercel.app}}"
IAM_USER="${IAM_USER:-${BUCKET}-app}"
PUBLIC_READ="${PUBLIC_READ:-1}"   # 0 = private bucket (use CloudFront OAC instead)
CREATE_KEY="${CREATE_KEY:-1}"
KEYS_FILE="${KEYS_FILE:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# aws.exe on Windows (Git Bash) needs native paths in file:// arguments
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "==> Bucket s3://$BUCKET already exists"
else
  echo "==> Creating bucket s3://$BUCKET in $REGION"
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  fi
fi
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

if [ "$PUBLIC_READ" = "1" ]; then
  echo "==> Allowing public read via bucket policy (Block Public Access: policies only)"
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false'
  cat > "$TMP/policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadMedia",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET/*"
  }]
}
EOF
  aws s3api put-bucket-policy --bucket "$BUCKET" --policy "file://$(native "$TMP/policy.json")"
else
  echo "==> Keeping the bucket fully private (configure CloudFront OAC, see note below)"
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
fi

echo "==> Applying CORS (PUT allowed from $APP_ORIGINS and http://localhost:3000)"
ORIGINS_JSON="$(echo "$APP_ORIGINS" | sed 's/[[:space:]]//g; s/,/", "/g')"
sed "s#\"https://YOUR-APP.vercel.app\"#\"${ORIGINS_JSON}\"#" "$HERE/s3-cors.json" > "$TMP/cors.json"
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "file://$(native "$TMP/cors.json")"

echo "==> IAM user $IAM_USER with access to this bucket only"
aws iam get-user --user-name "$IAM_USER" >/dev/null 2>&1 || aws iam create-user --user-name "$IAM_USER" >/dev/null
# s3:GetObject also authorises HeadObject; ListBucket is needed for HEAD on missing keys to return 404.
cat > "$TMP/iam.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "MediaObjects",
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
    "Resource": "arn:aws:s3:::$BUCKET/*"
  }, {
    "Sid": "MediaList",
    "Effect": "Allow",
    "Action": ["s3:ListBucket"],
    "Resource": "arn:aws:s3:::$BUCKET"
  }]
}
EOF
aws iam put-user-policy --user-name "$IAM_USER" --policy-name museum-media --policy-document "file://$(native "$TMP/iam.json")"

if [ "$CREATE_KEY" != "1" ]; then
  echo "Done (no access key created: CREATE_KEY=0)."
  exit 0
fi
KEYS="$(aws iam create-access-key --user-name "$IAM_USER" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"
KEY_ID="$(echo "$KEYS" | cut -f1)"
KEY_SECRET="$(echo "$KEYS" | cut -f2)"

if [ -n "$KEYS_FILE" ]; then
  umask 077
  printf 'S3_BUCKET=%s\nAWS_REGION=%s\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n' "$BUCKET" "$REGION" "$KEY_ID" "$KEY_SECRET" > "$KEYS_FILE"
  echo "Done. Access key $KEY_ID for $IAM_USER written to $KEYS_FILE (keep it out of git)."
  exit 0
fi

cat <<EOF

Done. Set these on Vercel (Project → Settings → Environment Variables) and in .env.local:

  S3_BUCKET=$BUCKET
  AWS_REGION=$REGION
  AWS_ACCESS_KEY_ID=$KEY_ID
  AWS_SECRET_ACCESS_KEY=<printed once below — store it in a password manager>
  # optional: S3_PUBLIC_BASE_URL=https://dxxxxxxxx.cloudfront.net

  secret: $KEY_SECRET

Note (CloudFront, recommended for production traffic):
  create a distribution with this bucket as origin + Origin Access Control, cache policy
  "CachingOptimized", response-headers policy "CORS-With-Preflight" (or SimpleCORS), then set
  S3_PUBLIC_BASE_URL to the distribution URL. Range requests (video seeking) work through CloudFront.
EOF
