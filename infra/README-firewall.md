# Vercel Firewall (WAF) rules

`vercel-firewall.json` is the live project firewall config (per-IP rate limits in front of the
public write endpoints). The app also has its own per-instance limiters; these rules cap traffic
across all instances before it reaches a function. Hobby plan: at most 3 custom rules.

Apply (replaces the whole config):

```sh
curl -X PUT "https://api.vercel.com/v1/security/firewall/config?projectId=$VERCEL_PROJECT_ID&teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "content-type: application/json" \
  --data @infra/vercel-firewall.json
```

| Rule | Paths | Limit (per IP) |
|---|---|---|
| Analytics ingestion | `/api/analytics/*` | 120 / min |
| Error reports, prints, comments | `/api/errors`, `POST /api/prints`, `POST /api/comments` | 30 / min |
| Sign-in | `/api/auth/login`, `/api/auth/register`, `/api/auth/google` | 20 / min |

Over the limit the request is denied (403, `x-vercel-mitigated: deny`) for the rest of the window.
