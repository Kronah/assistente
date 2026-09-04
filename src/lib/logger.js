"use strict";

const fs = require("fs");
const path = require("path");

function initLogger(serviceName = "app") {
  const safeName = String(serviceName || "app").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "app";
  const dataDir = path.resolve(__dirname, "..", "..", "data");
  const outFile = path.join(dataDir, `${safeName}.log`);
  const errorFile = path.join(dataDir, `${safeName}-error.log`);

  fs.mkdirSync(dataDir, { recursive: true });

  const rawLog = console.log.bind(console);
  const rawError = console.error.bind(console);

  function write(filePath, args) {
    const line = `[${new Date().toISOString()}] ${args.map(formatArg).join(" ")}`;
    fs.appendFile(filePath, `${line}\n`, () => {});
    return line;
  }

  console.log = (...args) => rawLog(write(outFile, args));
  console.error = (...args) => rawError(write(errorFile, args));

  return { outFile, errorFile };
}

function formatArg(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

module.exports = { initLogger };