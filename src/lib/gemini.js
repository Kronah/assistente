"use strict";

const fs = require("fs");
const path = require("path");

const { loadEnv } = require("./env");

loadEnv();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_IMAGE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 25 * 1000);
const GEMINI_IMAGE_TIMEOUT_MS = Number(process.env.GEMINI_IMAGE_TIMEOUT_MS || 60 * 1000);
const MAX_IMAGE_BYTES = Number(process.env.GEMINI_MAX_IMAGE_BYTES || 10 * 1024 * 1024);
const MAX_AUDIO_BYTES = Number(process.env.GEMINI_MAX_AUDIO_BYTES || 20 * 1024 * 1024);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const GEMINI_USAGE_FILE = process.env.GEMINI_USAGE_FILE || path.join(DATA_DIR, "gemini-usage.json");
const DEFAULT_SYSTEM_PROMPT = [
  "Voce e um assistente pessoal de WhatsApp.",
  "Responda em portugues do Brasil.",
  "Seja direto, educado e util.",
  "Quando faltar informacao, faca uma pergunta objetiva.",
  "Nao invente dados."
].join(" ");

let quotaBlockedUntil = 0;

function getEndOfDayTimestamp() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime();
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readUsage() {
  try {
    const raw = fs.readFileSync(GEMINI_USAGE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const today = getTodayKey();

    if (parsed?.date !== today) {
      return {
        date: today,
        requests: 0,
        success: 0,
        errors: 0,
        quotaErrors: 0,
        quotaBlockedUntil: 0,
        updatedAt: new Date().toISOString()
      };
    }

    return {
      date: today,
      requests: Number(parsed.requests || 0),
      success: Number(parsed.success || 0),
      errors: Number(parsed.errors || 0),
      quotaErrors: Number(parsed.quotaErrors || 0),
      quotaBlockedUntil: Number(parsed.quotaBlockedUntil || 0),
      updatedAt: parsed.updatedAt || new Date().toISOString()
    };
  } catch (error) {
    return {
      date: getTodayKey(),
      requests: 0,
      success: 0,
      errors: 0,
      quotaErrors: 0,
      quotaBlockedUntil: 0,
      updatedAt: new Date().toISOString()
    };
  }
}

function writeUsage(usage) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(GEMINI_USAGE_FILE, JSON.stringify(usage, null, 2));
}

function mutateUsage(mutator) {
  const current = readUsage();
  const next = mutator({ ...current }) || current;
  next.updatedAt = new Date().toISOString();
  writeUsage(next);
  return next;
}

function getGeminiQuotaStatus() {
  const usage = readUsage();
  const blockedUntil = Math.max(usage.quotaBlockedUntil || 0, quotaBlockedUntil || 0);
  const isBlocked = Date.now() < blockedUntil;
  const isExhausted = isBlocked || Number(usage.quotaErrors || 0) > 0;

  return {
    date: usage.date,
    requests: usage.requests,
    success: usage.success,
    errors: usage.errors,
    quotaErrors: usage.quotaErrors,
    blockedUntil,
    isBlocked,
    isExhausted,
    updatedAt: usage.updatedAt
  };
}

function isGeminiConfigured() {
  return Boolean(GEMINI_API_KEY);
}

function checkQuota() {
  const usage = readUsage();
  const persistedBlockedUntil = Number(usage.quotaBlockedUntil || 0);
  const hasQuotaErrorToday = Number(usage.quotaErrors || 0) > 0;
  const effectiveBlockedUntil = Math.max(quotaBlockedUntil, persistedBlockedUntil);

  if (Date.now() < effectiveBlockedUntil || hasQuotaErrorToday) {
    if (!quotaBlockedUntil && hasQuotaErrorToday) {
      quotaBlockedUntil = getEndOfDayTimestamp();
    } else {
      quotaBlockedUntil = effectiveBlockedUntil;
    }
    return true;
  }

  return false;
}

function recordError(isQuotaError) {
  mutateUsage((usage) => {
    usage.errors += 1;
    if (isQuotaError) {
      usage.quotaErrors += 1;
      usage.quotaBlockedUntil = quotaBlockedUntil;
    }
    return usage;
  });
}

function buildSystemInstruction(systemPrompt) {
  return {
    parts: [{ text: systemPrompt }]
  };
}

function buildParts({ text = "", image, audio }) {
  const parts = [];

  if (text) parts.push({ text });
  if (image && image.base64 && image.mimeType) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64
      }
    });
  }
  if (audio && audio.base64 && audio.mimeType) {
    parts.push({
      inlineData: {
        mimeType: audio.mimeType,
        data: audio.base64
      }
    });
  }

  return parts;
}

function makeGenerationRequest(url, systemPrompt, parts, generationConfig, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const promise = fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },
    signal: controller.signal,
    body: JSON.stringify({
      systemInstruction: buildSystemInstruction(systemPrompt),
      contents: [{ role: "user", parts }],
      generationConfig
    })
  });

  return promise.finally(() => clearTimeout(timeout));
}

function extractText(data) {
  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
}

function extractInlineImage(data) {
  const part = data.candidates?.[0]?.content?.parts
    ?.find((p) => p.inlineData && String(p.inlineData.mimeType || "").startsWith("image/"));
  return part?.inlineData || null;
}

async function askGemini(prompt, options = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY nao configurada.");
  }

  if (checkQuota()) {
    throw new Error("Cota Gemini estourada no dia atual.");
  }

  mutateUsage((usage) => {
    usage.requests += 1;
    return usage;
  });

  const systemPrompt = options.systemPrompt || process.env.GEMINI_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  const parts = buildParts({
    text: prompt,
    image: options.image,
    audio: options.audio
  });

  if (!parts.length) {
    throw new Error("Nada para enviar ao Gemini.");
  }

  if (options.image && !options.image.base64) {
    throw new Error("Imagem sem dados base64.");
  }

  if (options.audio && !options.audio.base64) {
    throw new Error("Audio sem dados base64.");
  }

  let response;
  try {
    response = await makeGenerationRequest(
      GEMINI_URL,
      systemPrompt,
      parts,
      {
        temperature: Number(process.env.GEMINI_TEMPERATURE || 0.6),
        maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 900)
      },
      GEMINI_TIMEOUT_MS
    );
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timeout Gemini depois de ${GEMINI_TIMEOUT_MS}ms.`);
    }
    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.message || `Erro HTTP ${response.status}`;
    const isQuotaError = message.toLowerCase().includes("quota");
    if (isQuotaError) {
      quotaBlockedUntil = getEndOfDayTimestamp();
      mutateUsage((usage) => {
        usage.quotaBlockedUntil = quotaBlockedUntil;
        return usage;
      });
    }
    recordError(isQuotaError);
    throw new Error(message);
  }

  const text = extractText(data);
  if (!text) {
    recordError(false);
    throw new Error("A Gemini API nao retornou texto.");
  }

  mutateUsage((usage) => {
    usage.success += 1;
    return usage;
  });

  return text;
}

async function generateImage(prompt, options = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY nao configurada.");
  }

  if (checkQuota()) {
    throw new Error("Cota Gemini estourada no dia atual.");
  }

  mutateUsage((usage) => {
    usage.requests += 1;
    return usage;
  });

  const systemPrompt = options.systemPrompt || process.env.GEMINI_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  const text = String(prompt || "").trim();
  if (!text) {
    throw new Error("Prompt de imagem vazio.");
  }

  let response;
  try {
    response = await makeGenerationRequest(
      GEMINI_IMAGE_URL,
      systemPrompt,
      [{ text }],
      {
        temperature: Number(process.env.GEMINI_TEMPERATURE || 0.6),
        responseModalities: ["TEXT", "IMAGE"]
      },
      GEMINI_IMAGE_TIMEOUT_MS
    );
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timeout ao gerar imagem depois de ${GEMINI_IMAGE_TIMEOUT_MS}ms.`);
    }
    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.message || `Erro HTTP ${response.status}`;
    const isQuotaError = message.toLowerCase().includes("quota");
    if (isQuotaError) {
      quotaBlockedUntil = getEndOfDayTimestamp();
      mutateUsage((usage) => {
        usage.quotaBlockedUntil = quotaBlockedUntil;
        return usage;
      });
    }
    recordError(isQuotaError);
    throw new Error(message);
  }

  const image = extractInlineImage(data);
  const textPart = extractText(data);

  if (image) {
    mutateUsage((usage) => {
      usage.success += 1;
      return usage;
    });
    return {
      base64: image.data,
      mimeType: image.mimeType,
      caption: textPart || ""
    };
  }

  recordError(false);
  throw new Error(textPart || "A API de imagem nao retornou nenhuma imagem.");
}

module.exports = {
  askGemini,
  generateImage,
  getGeminiQuotaStatus,
  isGeminiConfigured,
  GEMINI_MODEL,
  GEMINI_IMAGE_MODEL
};