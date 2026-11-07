#!/usr/bin/env node
// Builds dist/ from openapi.yaml (the single source of truth):
//   dist/index.html, swagger-ui-*.js/css   Swagger UI, bundled locally (no CDN)
//   dist/openapi.json, dist/openapi.yaml    the spec
//   dist/postman/<env>.postman_collection.json   one Postman collection per environment
//   dist/postman/index.json                 list of the collections (download links)
// The collections are generated from the spec, so they can't drift from it.
//
//   node build.mjs                 validate + build
//   node build.mjs --validate-only validate the spec, write nothing
//
// SWAGGER_PUBLIC_URL (optional): absolute base URL the page is served from, used
// only in postman/index.json links (default: relative links).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SPEC = path.join(here, "openapi.yaml");
const DIST = path.join(here, "dist");
const PUBLIC_URL = (process.env.SWAGGER_PUBLIC_URL || "").replace(/\/+$/, "");
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

// Environments the Postman collections are generated for.
const ENVIRONMENTS = [
  { key: "local", name: "Local", baseUrl: "http://localhost:4100" },
  { key: "dev", name: "Dev", baseUrl: "https://admin-dev-api.cots.ai" },
];

const raw = YAML.parse(readFileSync(SPEC, "utf8"));
// validate() dereferences a copy; keep `raw` (with $refs) for the published spec.
await SwaggerParser.validate(structuredClone(raw));
const spec = await SwaggerParser.dereference(structuredClone(raw));
const ops = Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).filter((m) => METHODS.has(m)).length, 0);
console.log(`openapi.yaml is valid: ${spec.info.title} ${spec.info.version}, ${Object.keys(spec.paths).length} paths, ${ops} operations`);
if (process.argv.includes("--validate-only")) process.exit(0);

// ------------------------------------------------------------------ dist/
rmSync(DIST, { recursive: true, force: true });
mkdirSync(path.join(DIST, "postman"), { recursive: true });

const ui = path.dirname(require.resolve("swagger-ui-dist/package.json"));
for (const f of ["swagger-ui.css", "swagger-ui-bundle.js", "swagger-ui-standalone-preset.js", "favicon-32x32.png", "favicon-16x16.png"]) {
  cpSync(path.join(ui, f), path.join(DIST, f));
}
cpSync(path.join(here, "index.html"), path.join(DIST, "index.html"));
writeFileSync(path.join(DIST, "openapi.json"), JSON.stringify(raw, null, 2));
cpSync(SPEC, path.join(DIST, "openapi.yaml"));

// ------------------------------------------------------- Postman collections
const index = [];
for (const env of ENVIRONMENTS) {
  const file = `cots-admin-${env.key}.postman_collection.json`;
  writeFileSync(path.join(DIST, "postman", file), JSON.stringify(collection(spec, env), null, 2));
  index.push({ environment: env.key, name: env.name, baseUrl: env.baseUrl, url: `${PUBLIC_URL}/postman/${file}` });
}
writeFileSync(path.join(DIST, "postman", "index.json"), JSON.stringify({ collections: index }, null, 2));
console.log(`dist/ written: Swagger UI + openapi.json + ${index.length} Postman collections (${index.map((c) => c.environment).join(", ")})`);

// ================================================================= helpers
function collection(spec, env) {
  const folders = new Map((spec.tags || []).map((t) => [t.name, { name: t.name, description: t.description, item: [] }]));
  for (const [route, pathItem] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!METHODS.has(method)) continue;
      const tag = op.tags?.[0] || "Other";
      if (!folders.has(tag)) folders.set(tag, { name: tag, item: [] });
      folders.get(tag).item.push(request(route, method, op, [...(pathItem.parameters || []), ...(op.parameters || [])], spec));
    }
  }
  return {
    info: {
      name: `Cots Admin API (${env.name})`,
      description:
        `${spec.info.description}\n\n---\n**Set before use:** \`session\` = the value of the \`cots_admin_session\` cookie ` +
        "(sign in on the admin console, then browser devtools → Application → Cookies). For scoped requests (dashboard, agents, actions) also " +
        "`tenantId` and `environmentId` (from `GET /api/v1/me/scope`).",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "baseUrl", value: env.baseUrl },
      { key: "session", value: "", description: "cots_admin_session cookie value" },
      { key: "tenantId", value: "release0:ten_acme", description: "x-tenant-id (admin tenant id)" },
      { key: "environmentId", value: "", description: "x-environment-id (uuid)" },
    ],
    item: [...folders.values()].filter((f) => f.item.length),
  };
}

function request(route, method, op, params, spec) {
  const secured = (op.security ?? spec.security ?? []).length > 0;
  const header = [];
  if (secured) header.push({ key: "Cookie", value: "cots_admin_session={{session}}" });
  const pathVars = [];
  const query = [];
  for (const p of params) {
    if (p.in === "header" && p.name === "x-tenant-id") header.push({ key: p.name, value: "{{tenantId}}" });
    else if (p.in === "header" && p.name === "x-environment-id") header.push({ key: p.name, value: "{{environmentId}}" });
    else if (p.in === "header") header.push({ key: p.name, value: String(sample(p.schema) ?? "") });
    else if (p.in === "path") pathVars.push({ key: p.name, value: String(p.schema?.example ?? ""), description: p.description });
    else if (p.in === "query") query.push({ key: p.name, value: String(sample(p.schema) ?? ""), description: p.description, disabled: !p.required });
  }
  const pathSegments = route.replace(/^\//, "").split("/").map((s) => s.replace(/^\{(.+)\}$/, ":$1"));
  const req = {
    method: method.toUpperCase(),
    header,
    url: {
      raw: `{{baseUrl}}/${pathSegments.join("/")}${query.length ? `?${query.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join("&")}` : ""}`,
      host: ["{{baseUrl}}"],
      path: pathSegments,
      ...(query.length ? { query } : {}),
      ...(pathVars.length ? { variable: pathVars } : {}),
    },
    description: [op.description, secured ? "Needs the session cookie ({{session}})." : "Public."].filter(Boolean).join("\n\n"),
  };
  const json = op.requestBody?.content?.["application/json"];
  if (json) {
    header.push({ key: "Content-Type", value: "application/json" });
    req.body = { mode: "raw", raw: JSON.stringify(json.example ?? sample(json.schema) ?? {}, null, 2), options: { raw: { language: "json" } } };
  }
  return { name: op.summary || `${method.toUpperCase()} ${route}`, request: req };
}

// A plausible example value for a (dereferenced) JSON schema.
function sample(schema, depth = 0) {
  if (!schema || depth > 6) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => sample(s, depth + 1) || {}));
  if (schema.oneOf || schema.anyOf) return sample((schema.oneOf || schema.anyOf).find((s) => s.type !== "null"), depth + 1);
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  switch (type) {
    case "object": {
      if (!schema.properties) return {};
      const out = {};
      for (const [k, v] of Object.entries(schema.properties)) {
        if (v.readOnly) continue;
        const val = sample(v, depth + 1);
        if (val !== undefined) out[k] = val;
      }
      return out;
    }
    case "array": return [sample(schema.items, depth + 1)].filter((v) => v !== undefined);
    case "integer": return schema.minimum ?? 1;
    case "number": return 1;
    case "boolean": return false;
    case "string":
      if (schema.format === "uuid") return "00000000-0000-4000-8000-000000000000";
      if (schema.format === "email") return "someone@cots.ai";
      if (schema.format === "uri") return "https://example.com";
      if (schema.format === "date-time") return new Date(0).toISOString();
      return "string";
    default: return undefined;
  }
}
