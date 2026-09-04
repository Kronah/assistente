"use strict";

const {
  downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const SEND_TIMEOUT_MS = Number(process.env.WHATSAPP_SEND_TIMEOUT_MS || 15 * 1000);
const MAX_MESSAGE_LENGTH = Number(process.env.WHATSAPP_MAX_MESSAGE_LENGTH || 3500);
const HUMAN_TYPING_ENABLED = String(process.env.HUMAN_TYPING_ENABLED || "true").toLowerCase() !== "false";
const HUMAN_TYPING_MIN_MS = Number(process.env.HUMAN_TYPING_MIN_MS || 500);
const HUMAN_TYPING_MAX_MS = Number(process.env.HUMAN_TYPING_MAX_MS || 3200);
const HUMAN_TYPING_MS_PER_CHAR = Number(process.env.HUMAN_TYPING_MS_PER_CHAR || 35);

function getMessageText(msg) {
  const message = unwrapMessage(msg.message || {});

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    ""
  );
}

function unwrapMessage(message) {
  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.documentWithCaptionMessage?.message ||
    message
  );
}

async function downloadMediaToBase64(msg, type) {
  const message = unwrapMessage(msg.message || {});
  const media = message.imageMessage || message.audioMessage || message.videoMessage;

  if (!media) return null;

  try {
    const stream = await downloadContentFromMessage(media, type);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) return null;

    const mimeType = String(media.mimetype || mimeForType(type)).trim() || mimeForType(type);
    return {
      base64: buffer.toString("base64"),
      mimeType,
      size: buffer.length
    };
  } catch (error) {
    console.error(`Falha ao baixar media (${type}):`, error.message);
    return null;
  }
}

function mimeForType(type) {
  return type === "image" ? "image/jpeg" : "audio/ogg";
}

async function extractImageFromMessage(msg) {
  return downloadMediaToBase64(msg, "image");
}

async function extractAudioFromMessage(msg) {
  return downloadMediaToBase64(msg, "audio");
}

function getMessageCaption(msg) {
  const message = unwrapMessage(msg.message || {});
  return (
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.audioMessage?.caption ||
    ""
  );
}

function isImageMessage(msg) {
  const message = unwrapMessage(msg.message || {});
  return Boolean(message.imageMessage);
}

function isAudioMessage(msg) {
  const message = unwrapMessage(msg.message || {});
  return Boolean(message.audioMessage) && !message.pttMessage;
}

function isVoiceMessage(msg) {
  const message = unwrapMessage(msg.message || {});
  return Boolean(message.audioMessage && message.audioMessage.pttMessage);
}

function isCommandLike(text) {
  return /^\s*[!./]/i.test(String(text || "").trim());
}

function isImageRequest(text) {
  const clean = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const verbs = [
    "crie uma imagem", "crie a imagem", "crie uma foto", "crie um desenho",
    "cria uma imagem", "cria uma foto", "cria um desenho", "cria imagem",
    "gerar uma imagem", "gere uma imagem", "gere imagem", "gera uma imagem",
    "gera uma foto", "desenhe", "desenha", "ilustre", "illustre",
    "faca uma imagem", "faça uma imagem", "gerar imagem", "crie imagem"
  ];
  const imageWords = ["imagem", "imagens", "foto", "fotos", "desenho", "desenhos", "ilustracao", "ilustração", "imagem de"];

  if (clean.includes("gerar imagem") || clean.includes("gere imagem") || clean.includes("gera imagem")) {
    return true;
  }

  for (const verb of verbs) {
    if (clean.includes(verb)) return true;
  }

  return imageWords.some((word) => clean.includes(word));
}

async function reply(sock, msg, text) {
  const jid = msg.key.remoteJid;
  const chunks = splitMessage(text);

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const shouldQuote = index === 0;

    try {
      await sendWithTimeout(sock, jid, chunk, shouldQuote ? { quoted: msg } : undefined);
      console.log(`Resposta enviada jid=${jid} quoted=${shouldQuote ? "sim" : "nao"} parte=${index + 1}/${chunks.length}`);
    } catch (error) {
      console.error(`Falha ao responder jid=${jid} quoted=${shouldQuote ? "sim" : "nao"}:`, error.message);

      if (shouldQuote) {
        await sendWithTimeout(sock, jid, chunk);
        console.log(`Resposta enviada jid=${jid} quoted=nao parte=${index + 1}/${chunks.length}`);
      } else {
        throw error;
      }
    }
  }
}

function sendWithTimeout(sock, jid, text, options) {
  return withTimeout(
    sendMessageWithHumanDelay(sock, jid, text, options),
    SEND_TIMEOUT_MS,
    `Timeout ao enviar mensagem depois de ${SEND_TIMEOUT_MS}ms`
  );
}

async function sendMessageWithHumanDelay(sock, jid, text, options) {
  await simulateHumanTyping(sock, jid, text);
  return sock.sendMessage(jid, { text }, options);
}

async function simulateHumanTyping(sock, jid, text) {
  if (!HUMAN_TYPING_ENABLED || !sock?.sendPresenceUpdate || !jid) {
    return;
  }

  const typingMs = estimateTypingDelay(text);

  try {
    await sock.sendPresenceUpdate("composing", jid);
    await delay(typingMs);
  } catch (error) {
    console.error("Falha ao simular digitacao:", error.message);
  } finally {
    try {
      await sock.sendPresenceUpdate("paused", jid);
    } catch (error) {
      console.error("Falha ao pausar digitacao:", error.message);
    }
  }
}

function estimateTypingDelay(text) {
  const size = String(text || "").trim().length;
  const base = size * HUMAN_TYPING_MS_PER_CHAR;
  const jitter = Math.floor(Math.random() * 280) - 140;
  return clamp(base + jitter, HUMAN_TYPING_MIN_MS, HUMAN_TYPING_MAX_MS);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitMessage(text) {
  const value = String(text || "");

  if (value.length <= MAX_MESSAGE_LENGTH) return [value];

  const chunks = [];
  let remaining = value;

  while (remaining.length > MAX_MESSAGE_LENGTH) {
    const slice = remaining.slice(0, MAX_MESSAGE_LENGTH);
    const breakAt = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const size = breakAt > 1000 ? breakAt : MAX_MESSAGE_LENGTH;

    chunks.push(remaining.slice(0, size).trim());
    remaining = remaining.slice(size).trim();
  }

  if (remaining) chunks.push(remaining);

  return chunks;
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;

  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise])
    .finally(() => clearTimeout(timeout));
}

module.exports = {
  getMessageText,
  unwrapMessage,
  reply,
  extractImageFromMessage,
  extractAudioFromMessage,
  getMessageCaption,
  isImageMessage,
  isAudioMessage,
  isVoiceMessage,
  isCommandLike,
  isImageRequest
};
