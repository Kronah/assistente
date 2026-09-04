"use strict";

const fs = require("fs");
const path = require("path");

const { loadEnv } = require("./lib/env");

loadEnv();

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "..", "data");
const STATUS_FILE = process.env.STATUS_FILE || path.join(DATA_DIR, "status.json");

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch (error) {
    return { connection: "unknown", qr: null, lastError: null, updatedAt: null };
  }
}

function writeStatus(update) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const current = readStatus();
  const next = { ...current, ...update, updatedAt: new Date().toISOString() };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2));
  return next;
}

module.exports = { readStatus, writeStatus };