# CloudFront CDN for museum media

Media (artworks, models, videos, audio uploaded through the admin) is stored in S3 and served through a
CloudFront distribution. Created with `infra/setup-cloudfront.sh`, which is idempotent: resources are
matched by name or Comment and reused.

| Resource | Value |
|---|---|
| Bucket | `hand-block-museum-media-626159998512` (ap-south-1) |
| Distribution | `EBRZGDB556TTY` with Comment `hand-block-museum-media-626159998512 media CDN` |
| Domain | **`https://d3rtt6mxyznwx8.cloudfront.net`** |
| Origin | `hand-block-museum-media-626159998512.s3.ap-south-1.amazonaws.com` (the S3 REST endpoint, not the website endpoint) |
| Origin Access Control | `E29CNCG6JT3L4M` (`…-oac`, sigv4, always sign) |
| Cache policy | managed **CachingOptimized** (`658327ea-f89d-4fab-a63d-7e88639e58f6`): honours the object `Cache-Control`, gzip + brotli |
| Origin request policy | managed **CORS-S3Origin** (`88a5eaf4-2fd4-4709-b370-b4c650ea3fcf`) |
| Response headers policy | custom `hand-block-museum-media-626159998512-cors` (`410dbbed-a8d2-4043-8f12-ceff5039bf3e`): `Access-Control-Allow-Origin: *`, methods GET/HEAD/OPTIONS, all request headers allowed, exposes `Content-Length, Content-Range, Accept-Ranges, ETag`, max-age 86400, origin override on |
| Protocols | HTTP/2 + HTTP/3 (`Alt-Svc: h3`), IPv6, redirect-to-https, compression on |
| Price class | `PriceClass_200` (includes India edge locations) |

## Bucket policy

The `AllowCloudFrontOAC` statement is merged into the existing policy:

```json
{ "Sid": "AllowCloudFrontOAC", "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" },
  "Action": "s3:GetObject", "Resource": "arn:aws:s3:::hand-block-museum-media-626159998512/*",
  "Condition": { "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::626159998512:distribution/EBRZGDB556TTY" } } }
```

The public-read statement `PublicReadMedia` is **kept**, so any absolute
`https://<bucket>.s3.ap-south-1.amazonaws.com/...` URLs already stored in content keep working. To make the bucket
CloudFront-only later, first rewrite the stored URLs to the CloudFront domain. Then remove `PublicReadMedia` and
set Block Public Access `BlockPublicPolicy=true,RestrictPublicBuckets=true`, which is what `PUBLIC_READ=0 ./infra/setup-s3.sh` does.

The bucket CORS rules in `infra/s3-cors.json` still matter for two things: presigned admin `PUT` uploads, which go
straight to S3, and direct S3 GETs.

## App configuration

`S3_PUBLIC_BASE_URL=https://d3rtt6mxyznwx8.cloudfront.net` is set in Vercel for production, preview and
development. It is also in `.env.local` as `REMOTE_S3_PUBLIC_BASE_URL`, which the app reads only when
`USE_REMOTE=1` (see `src/server/config.ts`). `S3Storage.urlFor()` then returns CloudFront URLs, so **new
uploads get CloudFront URLs**. Existing records keep the URL they were saved with. Uploads keep going to S3 through presigned PUTs.
Env changes only take effect after a redeploy.

## Verification

```bash
D=d3rtt6mxyznwx8.cloudfront.net
aws s3 cp hello.txt s3://hand-block-museum-media-626159998512/_cdn-test/hello.txt --content-type text/plain --cache-control "public, max-age=60"
curl -sI -H 'Origin: https://example.com' https://$D/_cdn-test/hello.txt     # 200, Access-Control-Allow-Origin: *, X-Cache: Miss → Hit
curl -s -D - -o /dev/null -H 'Range: bytes=0-99' https://$D/_cdn-test/big.jpg  # 206 + Content-Range (video seeking)
curl -s -X OPTIONS -D - -o /dev/null -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: GET' https://$D/_cdn-test/hello.txt
aws s3 rm s3://hand-block-museum-media-626159998512/_cdn-test/ --recursive
```

Results observed on 2026-09-23:
- a HEAD request returned `200`, then `X-Cache: Hit from cloudfront` on the second request, with `Access-Control-Allow-Origin: *` and the exposed headers listed above;
- a Range request returned `206` with `Content-Range: bytes 0-99/980648`;
- the preflight returned `Access-Control-Allow-Methods: GET,HEAD,OPTIONS`;
- text was served with `Content-Encoding: br`;
- HTTP/2 negotiated, and `Alt-Svc: h3=":443"` was advertised.

## Cache invalidation

Uploaded objects have unique names and `Cache-Control: public, max-age=31536000, immutable`, so they never need invalidating. If you
overwrite a key in place:

```bash
aws cloudfront create-invalidation --distribution-id EBRZGDB556TTY --paths "/artworks/hero-01.jpg"   # or "/*"
```

The first 1,000 invalidation paths each month are free.

## Custom domain (optional)

1. Request a certificate in ACM in **us-east-1**, which CloudFront requires, for e.g. `media.example.org`, and validate it with DNS.
2. Update the distribution: add `Aliases` = `media.example.org` and set `ViewerCertificate` to that ACM certificate with `sni-only` and `TLSv1.2_2021`.
3. Create a DNS CNAME `media.example.org` → `d3rtt6mxyznwx8.cloudfront.net` (or a Route 53 ALIAS record).
4. Set `S3_PUBLIC_BASE_URL=https://media.example.org` and redeploy.
