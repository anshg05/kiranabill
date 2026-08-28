const fs = require("fs");
const path = require("path");

const baseDir = __dirname;
const expectedPath = path.join(baseDir, "voice-cases.json");
const actualPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(baseDir, "actual-results.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeValue(value) {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number(value.toFixed(3));
  }
  return value;
}

function normalizeTranscript(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareItem(expected, actual) {
  const fields = ["displayName", "qty", "unit", "rate", "total", "priceType", "isCustom"];
  const diffs = [];

  fields.forEach((field) => {
    const expectedValue = normalizeValue(expected ? expected[field] : null);
    const actualValue = normalizeValue(actual ? actual[field] : null);

    if (expectedValue !== actualValue) {
      diffs.push(`${field}: expected=${JSON.stringify(expectedValue)} actual=${JSON.stringify(actualValue)}`);
    }
  });

  return diffs;
}

function buildScaffold(expectedCases) {
  return expectedCases.map((entry) => ({
    id: entry.id,
    actualTranscript: "",
    actualItems: []
  }));
}

function main() {
  const expectedCases = readJson(expectedPath);

  if (!fs.existsSync(actualPath)) {
    const scaffold = buildScaffold(expectedCases);
    fs.writeFileSync(actualPath, JSON.stringify(scaffold, null, 2) + "\n", "utf8");
    console.log(`Created scaffold: ${actualPath}`);
    console.log("Fill actualTranscript and actualItems from local testing, then rerun this script.");
    process.exit(0);
  }

  const actualCases = readJson(actualPath);
  const actualById = new Map(actualCases.map((entry) => [entry.id, entry]));
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  let skipCount = 0;

  expectedCases.forEach((expectedCase) => {
    const actualCase = actualById.get(expectedCase.id);

    if (!actualCase) {
      failCount += 1;
      console.log(`FAIL ${expectedCase.id}: missing actual result`);
      return;
    }

    const actualTranscript = String(actualCase.actualTranscript || "").trim();
    const expectedTranscript = String(expectedCase.expectedTranscript || "").trim();
    const expectedItems = Array.isArray(expectedCase.expectedItems) ? expectedCase.expectedItems : [];
    const actualItems = Array.isArray(actualCase.actualItems) ? actualCase.actualItems : [];
    const untouchedCase = !actualTranscript && actualItems.length === 0;

    if (untouchedCase) {
      skipCount += 1;
      console.log(`SKIP ${expectedCase.id}: ${expectedCase.utterance}`);
      return;
    }

    const transcriptOk = normalizeTranscript(actualTranscript) === normalizeTranscript(expectedTranscript);
    const itemCountOk = expectedItems.length === actualItems.length;
    const itemDiffs = [];

    const maxLength = Math.max(expectedItems.length, actualItems.length);
    for (let index = 0; index < maxLength; index += 1) {
      const diffs = compareItem(expectedItems[index], actualItems[index]);
      if (diffs.length) {
        itemDiffs.push(`item ${index + 1}: ${diffs.join("; ")}`);
      }
    }

    if (!itemCountOk || itemDiffs.length) {
      failCount += 1;
      console.log(`FAIL ${expectedCase.id}: ${expectedCase.utterance}`);
      if (!transcriptOk) {
        console.log(`  transcript expected=${JSON.stringify(expectedTranscript)} actual=${JSON.stringify(actualTranscript)}`);
      }
      if (!itemCountOk) {
        console.log(`  item count expected=${expectedItems.length} actual=${actualItems.length}`);
      }
      itemDiffs.forEach((line) => {
        console.log(`  ${line}`);
      });
      return;
    }

    if (!transcriptOk) {
      warnCount += 1;
      console.log(`WARN ${expectedCase.id}: ${expectedCase.utterance}`);
      console.log(`  transcript expected=${JSON.stringify(expectedTranscript)} actual=${JSON.stringify(actualTranscript)}`);
      return;
    }

    passCount += 1;
    console.log(`PASS ${expectedCase.id}: ${expectedCase.utterance}`);
  });

  console.log("");
  console.log(`Summary: pass=${passCount} warn=${warnCount} fail=${failCount} skip=${skipCount} total=${expectedCases.length}`);
  process.exitCode = failCount ? 1 : 0;
}

main();
