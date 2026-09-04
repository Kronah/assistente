"use strict";

const path = require("path");

const express = require("express");
const QRCode = require("qrcode");

const { loadEnv } = require("./src/lib/env");
const { readStatus } = require("./src/web-status");
const { isGeminiConfigured, GEMINI_MODEL } = require("./src/lib/gemini");

loadEnv();

const app = express();
const PORT = Number(process.env.WEB_PORT || 3001);
const HOST = process.env.WEB_HOST || "0.0.0.0";
const BOT_NAME = process.env.BOT_NAME || "Assistente IA";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "web")));

app.get("/api/status", async (req, res) => {
  const runtime = readStatus();
  const qrImage = runtime.qr ? await QRCode.toDataURL(runtime.qr, { margin: 1, width: 320 }) : null;

  res.json({
    botName: BOT_NAME,
    runtime,
    qrImage,
    gemini: {
      configured: isGeminiConfigured(),
      model: GEMINI_MODEL
    }
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Gerenciador web em http://${HOST}:${PORT}`);
});