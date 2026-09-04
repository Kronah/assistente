# ASSISTENTE IA - SAVE/RESUME (2026-09-04)

## OBJETIVO
Bot de WhatsApp (número novo) rodando no S20 FE como assistente pessoal de IA.
- Texto, áudio (nota de voz), ver imagens, e gerar imagens.
- Usa Google Gemini API (gratuito).

## ACESSOS E CREDENCIAIS

### S20 FE (Termux) - SSH
- Tailscale IP: `100.123.111.91` | porta SSH: `8022`
- Usuário Termux: `u0_a627`
- Senha SSH: `12345678`
- LAN IP: `192.168.55.14`
- Web do bot (QR/status): `http://100.123.111.91:3001` (Tailscale) ou `http://192.168.55.14:3001` (LAN)
- Acesso visual: via AnyDesk (tela do celular)

### GitHub
- Repositório: `Kronah/assistente` (https://github.com/Kronah/assistente)
- Acesso Windows: chave SSH `C:\Users\Administrator\.ssh\id_ed25519_github` (registrada no GitHub como "Windows-bot")
- Push via SSH: `git@github.com:Kronah/assistente.git`

### Ferramentas locais (Windows)
- `C:\Users\ADMINI~1\AppData\Local\Temp\opencode\plink.exe` e `pscp.exe` (PuTTY)
- Projeto local: `C:\Users\ADMINI~1\AppData\Local\Temp\opencode\assistente`
- Chave SSH do S20 (para acessar S20): `C:\Users\ADMINI~1\AppData\Local\Temp\opencode\id_ed25519_termux`
- Host key S20: `SHA256:U8LEcslPfie07nYNX3qNJAFHfDDUECmIxErnUQsyY70`

### Gemini API
- Chave: `AIzaSyAXYqZ0D7SeLWK7SgjjqOW7t_nCEWDsEEU`
- Modelo texto: `gemini-3.6-flash`
- Modelo imagem: `gemini-3.1-flash-image` (gratuito; `gemini-3-pro-image` NÃO tem cota free)

## LOCALIZAÇÃO DO BOT NO S20
- Pasta: `/data/data/com.termux/files/home/assistente`
- Bot: `npm start` (roda `src/index.js`)
- Web: `node web.js` (porta 3001, mostra QR)
- `.env` contém a chave e modelos

## ESTRUTURA DO BOT
```
assistente/
  package.json        (deps: baileys ^6.7.18, express, qrcode, pino)
  .env                (chave Gemini + modelos)
  .env.example
  web.js              (painel web - QR + status, porta 3001)
  web/index.html      (página web simples)
  src/index.js        (conexão WhatsApp Baileys + roteamento de msg)
  src/web-status.js   (lê/escreve data/status.json)
  src/lib/gemini.js   (texto/audio/imagem + gerar imagem; cota POR MODELO)
  src/lib/messages.js (extrai texto, imagem, áudio do WhatsApp)
  src/lib/env.js, logger.js
```

## STATUS ATUAL (último checkpoint)
- ✅ Bot criado do zero, no GitHub, clonado no S20
- ✅ npm install OK, protobufjs postinstall aprovado
- ✅ Bot conectou e RESpondeu mensagens de texto (funcionava)
- ✅ Modelos corrigidos: gemini-3.6-flash (texto) e gemini-3.1-flash-image (imagem)
- ✅ Cota corrigida (separada por modelo)
- ⚠️ PROBLEMA EM ABERTO: WhatsApp caindo com "Connection Failure" persistente
  - Internet do celular OK (curl web.whatsapp.com = 200)
  - Sessão possivelmente corrompida pelas muitas reconexões
- ⏸️ FIZ: apaguei `auth_info` para regenerar sessão (ainda não reiniciei/escanei de novo)

## PRÓXIMOS PASSOS (retomar de onde paramos)
1. Iniciar o bot de novo para gerar QR novo:
   ```bash
   cd ~/assistente && npm start
   ```
2. Escanear o QR no WhatsApp do NÚMERO NOVO
   (Configurações → Aparelhos conectados → Conectar aparelho)
3. Verificar se conecta (`connection: open` no `data/status.json`)
4. Testar: texto, áudio, foto, gerar imagem
5. Se ainda der "Connection Failure":
   - Considerar atualizar Baileys (`npm install @whiskeysockets/baileys@latest`)
   - Verificar estabilidade da rede do celular

## COMANDOS ÚTEIS (Termux - S20)
```bash
# Ver processo do bot
ps aux | grep node
# Ver status da conexão
cat ~/assistente/data/status.json
# Ver logs
tail -20 ~/assistente/data/bot.log
tail -5 ~/assistente/data/bot-error.log
# Reiniciar bot
cd ~/assistente && pkill -f 'node src/index'; npm start
# Manter bot vivo (IMPORTANTE - não matar quando tela desliga)
termux-wake-lock
# Reiniciar sshd (se SSH cair)
pkill -f sshd; sshd
```

## COMANDOS USAR DO WINDOWS (acessar S20 via plink)
```
plink -batch -hostkey "SHA256:U8LEcslPfie07nYNX3qNJAFHfDDUECmIxErnUQsyY70" -pw 12345678 -P 8022 u0_a627@100.123.111.91 "<comando>"
```
Exemplo:
```
plink -batch -hostkey "SHA256:U8LEcslPfie07nYNX3qNJAFHfDDUECmIxErnUQsyY70" -pw 12345678 -P 8022 u0_a627@100.123.111.91 "cat ~/assistente/data/status.json"
```

## NOTAS / PROBLEMAS JÁ RESOLVIDOS
- SSH instável ANTES: causa raiz = linha inválida `ClientAliveInterval 60` no `~/.ssh/config` do S20 (removida).
- Modelo `gemini-2.0-flash` descontinuado → trocado para `gemini-3.6-flash`.
- Modelo imagem `gemini-3-pro-image` sem cota free → trocado para `gemini-3.1-flash-image`.
- Cota Gemini bloqueava TODOS os modelos após 1 erro → agora é separada por modelo.

## PENDÊNCIAS / MELHORIAS FUTURAS
- [ ] Termux wake-lock configurado (rodar 24/7)
- [ ] Considerar iniciar bot via `pm2` para auto-reinício
- [ ] Resolver a desconexão persistente do WhatsApp (se ainda ocorrer após sessão nova)