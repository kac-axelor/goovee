#!/usr/bin/env node
// Usage: node scripts/missing-translation.mjs <locale> [path-to-directory]
// Example: node scripts/missing-translation.mjs en
//          node scripts/missing-translation.mjs fr app

import { readFileSync, readdirSync } from "fs";
import { join, extname } from "path";
import { parse, Lang } from "@ast-grep/napi";

const args = process.argv.slice(2);

if (args.length < 1) {
  console.error("Usage: node scripts/missing-translation.mjs <locale> [path-to-directory]");
  process.exit(1);
}

const locale = args[0];
const searchDir = args[1] ?? ".";
const jsonFile = `public/locales/${locale}.json`;

let translationKeys;
try {
  translationKeys = new Set(
    Object.keys(JSON.parse(readFileSync(jsonFile, "utf8")))
  );
} catch {
  console.error(`Error: Could not read or parse '${jsonFile}'`);
  process.exit(1);
}

function* walkTs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      yield* walkTs(full);
    } else if (entry.isFile() && (extname(entry.name) === ".tsx" || extname(entry.name) === ".ts")) {
      yield full;
    }
  }
}

const patterns = [
  { pattern: "i18n.t($ARG)", metavar: "ARG" },
  { pattern: "i18n.t($ARG, $$$REST)", metavar: "ARG" },
  { pattern: "t($ARG)", metavar: "ARG" },
  { pattern: "t($ARG, $$$REST)", metavar: "ARG" },
  { pattern: "getTranslation($OPT, $ARG)", metavar: "ARG" },
  { pattern: "getTranslation($OPT, $ARG, $$$REST)", metavar: "ARG" },
];

const foundKeys = new Set();

for (const file of walkTs(searchDir)) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const lang = extname(file) === ".tsx" ? Lang.Tsx : Lang.TypeScript;
  const root = parse(lang, source);

  for (const { pattern, metavar } of patterns) {
    for (const match of root.root().findAll(pattern)) {
      const argNode = match.getMatch(metavar);
      if (!argNode) continue;
      const text = argNode.text();
      if (
        (text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))
      ) {
        foundKeys.add(text.slice(1, -1));
      }
    }
  }
}

const missing = [...foundKeys].sort().filter((k) => k && !translationKeys.has(k));

for (const key of missing) {
  console.log(key);
}
