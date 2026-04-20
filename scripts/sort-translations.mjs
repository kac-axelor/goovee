#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const localesDir = "public/locales";

for (const file of readdirSync(localesDir)) {
  if (!file.endsWith(".json")) continue;
  const filePath = join(localesDir, file);
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  const sorted = Object.fromEntries(
    Object.keys(data)
      .sort()
      .map((k) => [k, data[k]])
  );
  writeFileSync(filePath, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`sorted ${filePath}`);
}
