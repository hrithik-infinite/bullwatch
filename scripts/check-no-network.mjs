#!/usr/bin/env node
// bullwatch invariant gate: the shipped bundles must make zero external
// network calls. This scans built output for external URLs and network
// primitives pointed at non-local hosts. Any hit fails CI.
//
// This is one half of the "provably local" guarantee. The other half — that
// job payloads are never written to disk or to non-`bull:*` Redis keys — is
// enforced by the payload-at-rest integration test (see CI).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// Hosts/schemes that are legitimate for a local-first tool to reference.
// Everything else is a violation.
const ALLOWED = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  // `.local` is reserved (RFC 6762 / mDNS) and never internet-routable. The
  // adapters build a Request against a synthetic `bullwatch.local` origin that
  // is routed on pathname only — it is never dialed.
  "local",
];

// Matches http(s)/ws(s) URLs.
const URL_RE = /\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi;

function collectFiles(dir, out) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (entry === "node_modules") continue;
      collectFiles(p, out);
    } else if (/\.(m?js|cjs)$/.test(entry)) {
      out.push(p);
    }
  }
}

function scanTarget(label, dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  collectFiles(dir, files);
  const violations = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(URL_RE)) {
      const host = m[1].toLowerCase();
      if (ALLOWED.some((a) => host === a || host.endsWith(`.${a}`))) continue;
      const line = text.slice(0, m.index).split("\n").length;
      violations.push({ file: file.replace(`${ROOT}/`, ""), line, url: m[0] });
    }
  }
  return violations;
}

const targets = [];
const pkgsDir = join(ROOT, "packages");
if (existsSync(pkgsDir)) {
  for (const pkg of readdirSync(pkgsDir)) {
    targets.push([`packages/${pkg}/dist`, join(pkgsDir, pkg, "dist")]);
  }
}

let all = [];
for (const [label, dir] of targets) {
  all = all.concat(scanTarget(label, dir));
}

if (all.length > 0) {
  console.error("❌ no-network gate FAILED — external references in shipped bundles:\n");
  for (const v of all) {
    console.error(`  ${v.file}:${v.line}  →  ${v.url}`);
  }
  console.error(
    "\nbullwatch must make zero external calls. Inline assets, remove the URL, " +
      "or (if genuinely local) add the host to ALLOWED in scripts/check-no-network.mjs.",
  );
  process.exit(1);
}

console.log("✅ no-network gate passed — no external references in shipped bundles.");
