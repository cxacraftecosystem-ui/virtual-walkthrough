#!/usr/bin/env bash
# Puts a CloudFront distribution in front of the museum media bucket.  REVIEW BEFORE RUNNING — it
# creates billable AWS resources.  Requires AWS CLI v2 (cloudfront + s3 permissions) and node (JSON).
# Idempotent: an existing OAC / response-headers policy / distribution (matched by name / Comment)
# is reused; the bucket policy statement is merged (the public-read statement is kept).
#
#   BUCKET=hand-block-museum-media-626159998512 REGION=ap-south-1 ./infra/setup-cloudfront.sh
#
# What it does (see infra/cloudfront.md):
#   1. Origin Access Control (sigv4, always sign) for the bucket
#   2. response-headers policy "<bucket>-cors": CORS GET/HEAD/OPTIONS from any origin, exposes
#      Content-Length / Content-Range / Accept-Ranges / ETag (WebGL textures, video Range requests)
#   3. distribution: S3 REST origin + OAC, managed cache policy CachingOptimized, managed origin
#      request policy CORS-S3Origin, HTTP/2+3, compression, redirect-to-https, GET/HEAD/OPTIONS,
#      PriceClass_200 (includes India edge locations)
#   4. bucket policy: adds "AllowCloudFrontOAC" (s3:GetObject for cloudfront.amazonaws.com,
#      AWS:SourceArn = this distribution)
#   5. waits for deployment and prints S3_PUBLIC_BASE_URL
set -euo pipefail

BUCKET="${BUCKET:?set BUCKET}"
REGION="${REGION:-ap-south-1}"
COMMENT="${COMMENT:-$BUCKET media CDN}"
OAC_NAME="${OAC_NAME:-$BUCKET-oac}"
RHP_NAME="${RHP_NAME:-$BUCKET-cors}"
PRICE_CLASS="${PRICE_CLASS:-PriceClass_200}"
WAIT="${WAIT:-1}"
CACHING_OPTIMIZED=658327ea-f89d-4fab-a63d-7e88639e58f6
CORS_S3_ORIGIN=88a5eaf4-2fd4-4709-b370-b4c650ea3fcf
ORIGIN_DOMAIN="$BUCKET.s3.$REGION.amazonaws.com"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }
none() { [ -z "$1" ] || [ "$1" = "None" ] || [ "$1" = "null" ]; }

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

echo "==> Origin Access Control $OAC_NAME"
OAC_ID="$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='$OAC_NAME'].Id | [0]" --output text)"
if none "$OAC_ID"; then
  OAC_ID="$(aws cloudfront create-origin-access-control --origin-access-control-config \
    "Name=$OAC_NAME,Description=museum media bucket,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
    --query OriginAccessControl.Id --output text)"
fi
echo "    $OAC_ID"

echo "==> Response headers policy $RHP_NAME"
RHP_ID="$(aws cloudfront list-response-headers-policies --type custom --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='$RHP_NAME'].ResponseHeadersPolicy.Id | [0]" --output text)"
if none "$RHP_ID"; then
  cat > "$TMP/rhp.json" <<EOF
{
  "Name": "$RHP_NAME",
  "Comment": "CORS GET/HEAD from any origin for museum media (WebGL textures, video)",
  "CorsConfig": {
    "AccessControlAllowOrigins": { "Quantity": 1, "Items": ["*"] },
    "AccessControlAllowHeaders": { "Quantity": 1, "Items": ["*"] },
    "AccessControlAllowMethods": { "Quantity": 3, "Items": ["GET", "HEAD", "OPTIONS"] },
    "AccessControlAllowCredentials": false,
    "AccessControlExposeHeaders": { "Quantity": 4, "Items": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"] },
    "AccessControlMaxAgeSec": 86400,
    "OriginOverride": true
  }
}
EOF
  RHP_ID="$(aws cloudfront create-response-headers-policy --response-headers-policy-config "file://$(native "$TMP/rhp.json")" \
    --query ResponseHeadersPolicy.Id --output text)"
fi
echo "    $RHP_ID"

echo "==> Distribution \"$COMMENT\""
DIST_ID="$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='$COMMENT'].Id | [0]" --output text)"
if none "$DIST_ID"; then
  cat > "$TMP/dist.json" <<EOF
{
  "CallerReference": "$BUCKET-$(date +%s)",
  "Comment": "$COMMENT",
  "Enabled": true,
  "HttpVersion": "http2and3",
  "IsIPV6Enabled": true,
  "PriceClass": "$PRICE_CLASS",
  "Origins": { "Quantity": 1, "Items": [{
    "Id": "s3-$BUCKET",
    "DomainName": "$ORIGIN_DOMAIN",
    "OriginAccessControlId": "$OAC_ID",
    "S3OriginConfig": { "OriginAccessIdentity": "" }
  }]},
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-$BUCKET",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": { "Quantity": 3, "Items": ["GET", "HEAD", "OPTIONS"],
      "CachedMethods": { "Quantity": 3, "Items": ["GET", "HEAD", "OPTIONS"] } },
    "Compress": true,
    "CachePolicyId": "$CACHING_OPTIMIZED",
    "OriginRequestPolicyId": "$CORS_S3_ORIGIN",
    "ResponseHeadersPolicyId": "$RHP_ID"
  }
}
EOF
  DIST_ID="$(aws cloudfront create-distribution --distribution-config "file://$(native "$TMP/dist.json")" --query Distribution.Id --output text)"
fi
DOMAIN="$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)"
DIST_ARN="arn:aws:cloudfront::$ACCOUNT:distribution/$DIST_ID"
echo "    $DIST_ID  https://$DOMAIN"

echo "==> Bucket policy: merge AllowCloudFrontOAC"
aws s3api get-bucket-policy --bucket "$BUCKET" --query Policy --output text > "$TMP/policy-old.json" 2>/dev/null || echo '{"Version":"2012-10-17","Statement":[]}' > "$TMP/policy-old.json"
node -e '
  const fs = require("fs")
  const [file, out, bucket, arn] = process.argv.slice(1)
  const p = JSON.parse(fs.readFileSync(file, "utf8"))
  p.Statement = (p.Statement || []).filter((s) => s.Sid !== "AllowCloudFrontOAC")
  p.Statement.push({
    Sid: "AllowCloudFrontOAC", Effect: "Allow",
    Principal: { Service: "cloudfront.amazonaws.com" },
    Action: "s3:GetObject", Resource: `arn:aws:s3:::${bucket}/*`,
    Condition: { StringEquals: { "AWS:SourceArn": arn } },
  })
  fs.writeFileSync(out, JSON.stringify(p))
' "$(native "$TMP/policy-old.json")" "$(native "$TMP/policy.json")" "$BUCKET" "$DIST_ARN"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "file://$(native "$TMP/policy.json")"

if [ "$WAIT" = "1" ]; then
  echo "==> Waiting for the distribution to deploy (5–15 min)…"
  aws cloudfront wait distribution-deployed --id "$DIST_ID"
fi

cat <<EOF

Done. Set on Vercel (production, preview, development) and in .env.local (REMOTE_S3_PUBLIC_BASE_URL):

  S3_PUBLIC_BASE_URL=https://$DOMAIN

Verify:  curl -sI -H 'Origin: https://example.com' https://$DOMAIN/<key>
EOF
