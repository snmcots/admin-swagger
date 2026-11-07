#!/usr/bin/env node
// Local preview of dist/ (what nginx serves on the box): http://localhost:4110
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const PORT = Number(process.env.PORT) || 4110;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".yaml": "application/yaml", ".png": "image/png" };

createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url === "/healthz") return res.end("ok\n");
  let file = path.join(DIST, path.normalize(url).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(DIST)) { res.statusCode = 400; return res.end(); }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file)) { res.statusCode = 404; return res.end("not found\n"); }
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Swagger UI: http://localhost:${PORT}`));
