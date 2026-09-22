#!/usr/bin/env bash
# Creates and configures the S3 bucket for museum media.  REVIEW BEFORE RUNNING — it creates
# billable AWS resources.  Requires AWS CLI v2 with credentials allowed to manage S3 (+ IAM).
#
#   BUCKET=hbp-museum-media REGION=ap-south-1 APP_ORIGIN=https://your-app.vercel.app ./infra/setup-s3.sh
#
# What it does:
#   1. creates the bucket (ACLs disabled / BucketOwnerEnforced)
#   2. allows a PUBLIC-READ bucket policy for GET on objects (museum media is public content)
#      — alternative: keep the bucket private and front it with CloudFront + Origin Access Control
#        (see the note at the end), then set S3_PUBLIC_BASE_URL to the CloudFront domain
#   3. applies CORS (GET/HEAD from anywhere for WebGL/crossOrigin textures & video; PUT from the
#      app origins for presigned admin uploads)
#   4. creates a least-privilege IAM user for the app and prints the env vars to set on Vercel
set -euo pipefail

BUCKET="${BUCKET:?set BUCKET (globally unique name)}"
REGION="${REGION:-ap-south-1}"
APP_ORIGIN="${APP_ORIGIN:?set APP_ORIGIN, e.g. https://your-app.vercel.app}"
IAM_USER="${IAM_USER:-${BUCKET}-app}"
PUBLIC_READ="${PUBLIC_READ:-1}"   # 0 = private bucket (use CloudFront OAC instead)
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Creating bucket s3://$BUCKET in $REGION"
if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION"
fi
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

if [ "$PUBLIC_READ" = "1" ]; then
  echo "==> Allowing public read via bucket policy (Block Public Access: policies only)"
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false'
  aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"PublicReadMedia\",
      \"Effect\": \"Allow\",
      \"Principal\": \"*\",
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::$BUCKET/*\"
    }]
  }"
else
  echo "==> Keeping the bucket fully private (configure CloudFront OAC, see note below)"
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
fi

echo "==> Applying CORS (PUT allowed from $APP_ORIGIN and http://localhost:3000)"
CORS_FILE="$(mktemp)"
sed "s#https://YOUR-APP.vercel.app#${APP_ORIGIN}#" "$HERE/s3-cors.json" > "$CORS_FILE"
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "file://$CORS_FILE"
rm -f "$CORS_FILE"

echo "==> Creating IAM user $IAM_USER with access to this bucket only"
aws iam create-user --user-name "$IAM_USER" >/dev/null
aws iam put-user-policy --user-name "$IAM_USER" --policy-name museum-media --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": [\"s3:PutObject\", \"s3:GetObject\", \"s3:DeleteObject\", \"s3:AbortMultipartUpload\"],
    \"Resource\": \"arn:aws:s3:::$BUCKET/*\"
  }, {
    \"Effect\": \"Allow\",
    \"Action\": [\"s3:ListBucket\"],
    \"Resource\": \"arn:aws:s3:::$BUCKET\"
  }]
}"
KEYS="$(aws iam create-access-key --user-name "$IAM_USER" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"

cat <<EOF

Done. Set these on Vercel (Project → Settings → Environment Variables) and in .env.local:

  S3_BUCKET=$BUCKET
  AWS_REGION=$REGION
  AWS_ACCESS_KEY_ID=$(echo "$KEYS" | cut -f1)
  AWS_SECRET_ACCESS_KEY=<printed once below — store it in a password manager>
  # optional: S3_PUBLIC_BASE_URL=https://dxxxxxxxx.cloudfront.net

  secret: $(echo "$KEYS" | cut -f2)

Note (CloudFront, recommended for production traffic):
  create a distribution with this bucket as origin + Origin Access Control, cache policy
  "CachingOptimized", response-headers policy "CORS-With-Preflight" (or SimpleCORS), then set
  S3_PUBLIC_BASE_URL to the distribution URL. Range requests (video seeking) work through CloudFront.
EOF
