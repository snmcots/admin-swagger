# admin-swagger

API docs for **admin-be**: one OpenAPI spec, plus a Swagger UI page and Postman collections generated from it.

| | Dev | Local |
|---|---|---|
| Swagger UI | https://admin-dev-swagger.cots.ai | http://localhost:4110 |
| Spec | `/openapi.json`, `/openapi.yaml` | same |
| Postman | `/postman/index.json` (links), `/postman/cots-admin-<env>.postman_collection.json` | same |

```
openapi.yaml   the spec -- the ONLY file you edit (source of truth)
build.mjs      validates the spec, writes dist/ (Swagger UI + openapi.json + Postman collections)
index.html     the Swagger UI page (UI bundled locally from swagger-ui-dist; no CDN)
serve.mjs      local preview of dist/ on :4110
dist/          build output (gitignored) -- the whole site, static
vercel.json    Vercel build settings (npm ci, npm run build, output dist/)
```

## Use

```bash
npm ci
npm run validate     # check openapi.yaml only
npm run build        # dist/
npm run dev          # build + serve on http://localhost:4110
../scripts/universal.sh start swagger      # same, alongside the backend (:4100) and frontend (:3100)
```

## Changing the API

1. Change the route in admin-be (`src/routes`, `src/validators`).
2. Change `openapi.yaml` to match: the path under `/api/v1`, its body/params, the permission in the summary, and the responses.
3. Run `npm run build`. If the spec is invalid, the build fails, and nothing is published.
4. Commit and push. Vercel rebuilds the site (see Deploy).

The Postman collections are **generated** from the spec, so never edit them by hand.

## Postman

Import a collection from its link (Postman → Import → Link): `https://admin-dev-swagger.cots.ai/postman/cots-admin-dev.postman_collection.json`. You can also download it from the bar at the top of the Swagger page.

Collection variables:

| Variable | Value |
|---|---|
| `baseUrl` | `https://admin-dev-api.cots.ai` (dev), `http://localhost:4100` (local) |
| `session` | The `cots_admin_session` cookie value: sign in on the admin console, then devtools → Application → Cookies. |
| `tenantId`, `environmentId` | The `x-tenant-id` / `x-environment-id` headers for the dashboard, agents and actions routes. Get them from `GET /api/v1/me/scope`. |

Each request already sends `Cookie: cots_admin_session={{session}}` where it's needed, and the scope headers where they're needed.

## Notes

- **"Try it out" on the docs page** works for the public routes (`/healthz`, `/readyz`). Signed-in routes need the session cookie, which belongs to the console's domain, not to the docs domain. Use Postman for those.
- **Adding another environment:** add an entry to `ENVIRONMENTS` in `build.mjs` and a server in `openapi.yaml`.
- **The docs site** is static files only; there's no backend behind it.

## Deploy (Vercel)

The site is static (`dist/`), so it doesn't run on the admin-app EC2 box; it's deployed on Vercel like admin-fe.

1. Make sure the Vercel GitHub app can see this repo (same steps as admin-fe), then import it on vercel.com/new.
2. Vercel reads `vercel.json`: install `npm ci`, build `npm run build`, output `dist/`, framework "Other".
   - **No environment variables** are needed.
   - If you set `SWAGGER_PUBLIC_URL=https://admin-dev-swagger.cots.ai`, the links in `postman/index.json` become absolute; without it they're relative, which works too.
3. Set the production branch, then add the domain `admin-dev-swagger.cots.ai`. In Cloudflare, create the record Vercel shows, as **DNS only** (grey cloud).
4. Check it:
   ```bash
   curl -sI https://admin-dev-swagger.cots.ai/openapi.json | head -1
   curl -s  https://admin-dev-swagger.cots.ai/postman/index.json | head -5
   ```

`vercel.json` also sets the response headers: the Postman collections download as files, and the spec and collections are always revalidated.
