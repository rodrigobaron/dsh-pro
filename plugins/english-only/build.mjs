// Wrap src/client.js into the factory form the harness's client module loader
// expects, and write it to lib/client.js.
//
// The harness serves a package's `./client` export verbatim — it does not
// bundle — so a client plugin must ship a file that already calls
// `window.__ModuleLoader__.load({ id, factory })`, resolves its dependencies
// through the injected `require`, and returns its exports. That is the only
// thing a bundler is doing for the shipped plugins, so this does it directly
// and the package stays free of any build dependency.
//
//   node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

const source = readFileSync(join(here, "src/client.js"), "utf8");
const lines = source.split("\n");
const requires = [];
const body = [];
const exported = [];

// Only the import forms this package actually uses are recognized; anything
// else stops the build rather than emitting a subtly wrong bundle.
const NAMED = /^import\s+\{([^}]+)\}\s+from\s+"([^"]+)";$/;
const DEFAULT = /^import\s+(\w+)\s+from\s+"([^"]+)";$/;
const EXPORT = /^export\s+\{([^}]+)\};$/;

for (const line of lines) {
  const named = NAMED.exec(line);
  if (named) {
    // `{ createElement as h, useState }` → `{ createElement: h, useState }`
    const bindings = named[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/^(\w+)\s+as\s+(\w+)$/, "$1: $2"))
      .join(", ");
    requires.push(`const { ${bindings} } = require(${JSON.stringify(named[2])});`);
    continue;
  }
  const dflt = DEFAULT.exec(line);
  if (dflt) {
    requires.push(`const ${dflt[1]} = require(${JSON.stringify(dflt[2])}).default;`);
    continue;
  }
  const exp = EXPORT.exec(line);
  if (exp) {
    exported.push(...exp[1].split(",").map((n) => n.trim()).filter(Boolean));
    continue;
  }
  if (/^\s*(import|export)\s/.test(line)) {
    throw new Error(`build: unsupported module syntax, hand-check it:\n  ${line}`);
  }
  body.push(line);
}

if (exported.length === 0) throw new Error("build: src/client.js exports nothing");

const out = [
  `window.__ModuleLoader__.load({`,
  `\tid: ${JSON.stringify(pkg.name)},`,
  `\tfactory: (require) => {`,
  `\t\tvar module = { exports: {} };`,
  `\t\tvar exports = module.exports;`,
  `\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`,
  ...requires.map((r) => `\t\t${r}`),
  ``,
  ...body,
  ``,
  ...exported.map((n) => `\t\texports.${n} = ${n};`),
  `\t\treturn module.exports;`,
  `\t},`,
  `});`,
  ``,
].join("\n");

mkdirSync(join(here, "lib"), { recursive: true });
writeFileSync(join(here, "lib/client.js"), out);
console.log(`built lib/client.js (${out.split("\n").length} lines, exports: ${exported.join(", ")})`);
