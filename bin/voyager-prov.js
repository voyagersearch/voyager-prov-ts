#!/usr/bin/env node
// Minimal CLI for voyager-prov-ts. Reads a ProvRecord as JSON on stdin and
// prints either the full { solrDoc, jsonld } result, the Solr doc alone, or
// the JSON-LD alone. Used by demonstrators + shell pipelines during D100 work.

import { readFileSync } from "node:fs";

import { emit } from "../dist/index.js";

const usage = `voyager-prov <emit|solr|jsonld>
  emit    — print { solrDoc, jsonld } (default)
  solr    — print only the Solr doc
  jsonld  — print only the JSON-LD blob

Reads a JSON ProvRecord from stdin.
`;

const cmd = process.argv[2] ?? "emit";
if (!["emit", "solr", "jsonld"].includes(cmd)) {
  process.stderr.write(usage);
  process.exit(2);
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch (err) {
  process.stderr.write(`voyager-prov: could not parse JSON on stdin: ${err.message}\n`);
  process.exit(2);
}

let result;
try {
  result = emit(input);
} catch (err) {
  process.stderr.write(`voyager-prov: emit failed: ${err.message}\n`);
  process.exit(1);
}

const out =
  cmd === "solr" ? result.solrDoc : cmd === "jsonld" ? result.jsonld : result;
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
