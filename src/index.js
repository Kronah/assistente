"use strict";

const {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState
} = require("@whiskeysockets/baileys");
const P = require("pino");
const qrcode = require("qrcode-terminal");

const { initLogger } = require("./lib/logger");
const { loadEnv } = require("./lib/env");
const { askGemini, generateImage, isGeminiConfigured } = require("./lib/gemini");
const {
  getMessageText,
  reply,
  extractImageFromMessage,
  extractAudioFromMessage,
  getMessageCaption,
  isImageRequest
} = require("./lib/messages");
const { writeStatus } = require("./web-status");

loadEnv();

const AUTH_DIR = process.env.AUTH_DIR || "auth_info";
const BOT_NAME = process.env.BOT_NAME || "Assistente IA";
const RECONNECT_DELAY_MS = Number(process.env.RECONNECT_DELAY_MS || 3000);
const SYSTEM_PROMPT = [
  "Voce e um assistente pessoal de WhatsApp.",
  "Responda em portugues do Brasil, de forma direta, educada e util.",
  "Quando faltar informacao, faca uma pergunta objetiva.",
  "Nao invente dados."
].join(" ");

initLogger("bot");

let reconnectTimer = null;
let reconnectAttempts = 0;

function cleanPrompt(text) {
  return String(text || "")
    .replace(/^\s*[!./]?(ia|ai|bot|gemini)\s*[:,;-]?\s*/i, "")
    .trim();
}

async function startBot() {
  writeStatus({ botName: BOT_NAME, connection: "starting", lastError: null });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: [BOT_NAME, "Chrome", "1.0.0"],
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      writeStatus({ botName: BOT_NAME, connection: "qr", qr, lastError: null });
      console.log("Leia este QR Code no WhatsApp para conectar:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      writeStatus({ botName: BOT_NAME, connection: "open", qr: null, lastError: null });
      reconnectAttempts = 0;
      console.log(`${BOT_NAME} conectado com sucesso.`);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      const lastError = lastDisconnect?.error?.message || "Conexao fechada";

      writeStatus({ botName: BOT_NAME, connection: "close", qr: null, lastError, shouldReconnect });
      console.log(`Conexao fechada. Reconectar: ${shouldReconnect}`);

      if (shouldReconnect) {
        if (reconnectTimer) return;
        reconnectAttempts += 1;
        const backoff = RECONNECT_DELAY_MS * Math.pow(2, Math.min(reconnectAttempts - 1, 6));
        console.log(`Reconectando em ${Math.round(backoff / 1000)}s (tentativa ${reconnectAttempts})...`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          startBot().catch((error) => console.error("Erro ao reconectar:", error));
        }, backoff);
      } else {
        console.log("Sessao encerrada. Apague auth_info e leia o QR novamente.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        await routeMessage(sock, msg);
      } catch (error) {
        console.error("Erro ao processar mensagem:", error.message);
      }
    }
  });
}

async function routeMessage(sock, msg) {
  if (!msg.message || msg.key.fromMe || !msg.key.remoteJid) return;

  const jid = msg.key.remoteJid;
  if (jid === "status@broadcast") return;

  const text = getMessageText(msg).trim();
  const caption = getMessageCaption(msg).trim();

  console.log(`Mensagem jid=${jid} texto=${text ? "sim" : "nao"}`);

  try {
    await sock.sendPresenceUpdate("composing", jid);
  } catch (error) {
    // ignore
  }

  try {
    const image = await extractImageFromMessage(msg);
    const audio = await extractAudioFromMessage(msg);

    let prompt = cleanPrompt(text || caption);

    if (image && !audio) {
      if (!prompt) prompt = "Descreva o que voce ve nesta imagem.";
      const answer = await askGemini(prompt, { systemPrompt: SYSTEM_PROMPT, image });
      await reply(sock, msg, answer);
      return;
    }

    if (audio) {
      if (!prompt) prompt = "Transcreva e resuma o audio, e responda de forma util.";
      const answer = await askGemini(prompt, { systemPrompt: SYSTEM_PROMPT, audio });
      await reply(sock, msg, answer);
      return;
    }

    if (!prompt) {
      await reply(sock, msg, [
        "Assistente pessoal pronto.",
        "",
        "Envie uma mensagem, nota de voz ou foto.",
        "Para gerar imagem, peca algo como: crie uma imagem de um gato."
      ].join("\n"));
      return;
    }

    if (isImageRequest(prompt)) {
      await reply(sock, msg, "Gerando imagem, aguarde...");
      try {
        const generated = await generateImage(prompt, { systemPrompt: SYSTEM_PROMPT });
        await sock.sendMessage(jid, {
          image: Buffer.from(generated.base64, "base64"),
          mimetype: generated.mimeType || "image/png",
          caption: generated.caption || prompt
        });
      } catch (error) {
        console.error("Erro ao gerar imagem:", error.message);
        await reply(sock, msg, `Nao consegui gerar a imagem: ${error.message}`);
      }
      return;
    }

    const answer = await askGemini(prompt, { systemPrompt: SYSTEM_PROMPT });
    await reply(sock, msg, answer);
  } catch (error) {
    console.error("Erro IA:", error.message);
    try {
      await reply(sock, msg, `Erro ao processar: ${error.message}`);
    } catch (replyError) {
      console.error("Falha ao enviar erro:", replyError.message);
    }
  } finally {
    try {
      await sock.sendPresenceUpdate("paused", jid);
    } catch (error) {
      // ignore
    }
  }
}

startBot().catch((error) => {
  console.error("Erro fatal ao iniciar o bot:", error);
  process.exit(1);
});