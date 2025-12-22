// 🧹 Fix for ENOSPC / temp overflow in hosted panels
const fs = require('fs');
const path = require('path');

// Redirect temp storage away from system /tmp
const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

// Auto-cleaner every 3 hours
setInterval(() => {
  fs.readdir(customTemp, (err, files) => {
    if (err) return;
    for (const file of files) {
      const filePath = path.join(customTemp, file);
      fs.stat(filePath, (err, stats) => {
        if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
          fs.unlink(filePath, () => {});
        }
      });
    }
  });
  console.log('🧹 Temp folder auto-cleaned');
}, 3 * 60 * 60 * 1000);

const settings = require('./settings');
require('./config.js');
const { isBanned } = require('./lib/isBanned');
const yts = require('yt-search');
const { fetchBuffer } = require('./lib/myfunc');
const fetch = require('node-fetch');
const ytdl = require('ytdl-core');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { isSudo } = require('./lib/index');
const isOwnerOrSudo = require('./lib/isOwner');
const { autotypingCommand, isAutotypingEnabled, handleAutotypingForMessage, handleAutotypingForCommand, showTypingAfterCommand } = require('./commands/autotyping');
const { autoreadCommand, isAutoreadEnabled, handleAutoread } = require('./commands/autoread');

// Command imports
const tagAllCommand = require('./commands/tagall');
const helpCommand = require('./commands/help');
const banCommand = require('./commands/ban');
const { promoteCommand } = require('./commands/promote');
const { demoteCommand } = require('./commands/demote');
const muteCommand = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const stickerCommand = require('./commands/sticker');
const isAdmin = require('./lib/isAdmin');
const warnCommand = require('./commands/warn');
const warningsCommand = require('./commands/warnings');
const ttsCommand = require('./commands/tts');
const { tictactoeCommand, handleTicTacToeMove } = require('./commands/tictactoe');
const { incrementMessageCount, topMembers } = require('./commands/topmembers');
const ownerCommand = require('./commands/owner');
const deleteCommand = require('./commands/delete');
const { handleAntilinkCommand, handleLinkDetection } = require('./commands/antilink');
const { handleAntitagCommand, handleTagDetection } = require('./commands/antitag');
const { Antilink } = require('./lib/antilink');
const { handleMentionDetection, mentionToggleCommand, setMentionCommand } = require('./commands/mention');
const memeCommand = require('./commands/meme');
const tagCommand = require('./commands/tag');
const tagNotAdminCommand = require('./commands/tagnotadmin');
const hideTagCommand = require('./commands/hidetag');
const jokeCommand = require('./commands/joke');
const quoteCommand = require('./commands/quote');
const factCommand = require('./commands/fact');
const weatherCommand = require('./commands/weather');
const newsCommand = require('./commands/news');
const kickCommand = require('./commands/kick');
const simageCommand = require('./commands/simage');
const attpCommand = require('./commands/attp');
const { startHangman, guessLetter } = require('./commands/hangman');
const { startTrivia, answerTrivia } = require('./commands/trivia');
const { complimentCommand } = require('./commands/compliment');
const { insultCommand } = require('./commands/insult');
const { eightBallCommand } = require('./commands/eightball');
const { lyricsCommand } = require('./commands/lyrics');
const { dareCommand } = require('./commands/dare');
const { truthCommand } = require('./commands/truth');
const { clearCommand } = require('./commands/clear');
const pingCommand = require('./commands/ping');
const aliveCommand = require('./commands/alive');
const blurCommand = require('./commands/img-blur');
const { welcomeCommand, handleJoinEvent } = require('./commands/welcome');
const { goodbyeCommand, handleLeaveEvent } = require('./commands/goodbye');
const githubCommand = require('./commands/github');
const { handleAntiBadwordCommand, handleBadwordDetection } = require('./lib/antibadword');
const antibadwordCommand = require('./commands/antibadword');
const { handleChatbotCommand, handleChatbotResponse } = require('./commands/chatbot');
const takeCommand = require('./commands/take');
const { flirtCommand } = require('./commands/flirt');
const characterCommand = require('./commands/character');
const wastedCommand = require('./commands/wasted');
const shipCommand = require('./commands/ship');
const groupInfoCommand = require('./commands/groupinfo');
const resetlinkCommand = require('./commands/resetlink');
const staffCommand = require('./commands/staff');
const unbanCommand = require('./commands/unban');
const emojimixCommand = require('./commands/emojimix');
const { handlePromotionEvent } = require('./commands/promote');
const { handleDemotionEvent } = require('./commands/demote');
const viewOnceCommand = require('./commands/viewonce');
const clearSessionCommand = require('./commands/clearsession');
const { autoStatusCommand, handleStatusUpdate } = require('./commands/autostatus');
const { simpCommand } = require('./commands/simp');
const { stupidCommand } = require('./commands/stupid');
const stickerTelegramCommand = require('./commands/stickertelegram');
const textmakerCommand = require('./commands/textmaker');
const { handleAntideleteCommand, handleMessageRevocation, storeMessage } = require('./commands/antidelete');
const clearTmpCommand = require('./commands/cleartmp');
const setProfilePicture = require('./commands/setpp');
const { setGroupDescription, setGroupName, setGroupPhoto } = require('./commands/groupmanage');
const instagramCommand = require('./commands/instagram');
const facebookCommand = require('./commands/facebook');
const spotifyCommand = require('./commands/spotify');
const playCommand = require('./commands/play');
const tiktokCommand = require('./commands/tiktok');
const songCommand = require('./commands/song');
const aiCommand = require('./commands/ai');
const urlCommand = require('./commands/url');
const { handleTranslateCommand } = require('./commands/translate');
const { handleSsCommand } = require('./commands/ss');
const { addCommandReaction, handleAreactCommand } = require('./lib/reactions');
const { goodnightCommand } = require('./commands/goodnight');
const { shayariCommand } = require('./commands/shayari');
const { rosedayCommand } = require('./commands/roseday');
const imagineCommand = require('./commands/imagine');
const videoCommand = require('./commands/video');
const sudoCommand = require('./commands/sudo');
const { miscCommand, handleHeart } = require('./commands/misc');
const { animeCommand } = require('./commands/anime');
const { piesCommand, piesAlias } = require('./commands/pies');
const stickercropCommand = require('./commands/stickercrop');
const updateCommand = require('./commands/update');
const removebgCommand = require('./commands/removebg');
const { reminiCommand } = require('./commands/remini');
const { igsCommand } = require('./commands/igs');
const { anticallCommand, readState: readAnticallState } = require('./commands/anticall');
const { pmblockerCommand, readState: readPmBlockerState } = require('./commands/pmblocker');
const settingsCommand = require('./commands/settings');
const soraCommand = require('./commands/sora');
// ;

// ================= PRESENCE COMMANDS (FIXED) =================

function presenceOnlyOwner(sock, chatId, message, senderIsOwnerOrSudo) {
  if (!message.key.fromMe && !senderIsOwnerOrSudo) {
    sock.sendMessage(chatId, { text: '❌ Owner / Sudo only command.' }, { quoted: message });
    return false;
  }
  return true;
  }
// ================= MESSAGE HANDLER =================

async function handleMessages(sock, messageUpdate) {
  const { messages, type } = messageUpdate;
  if (type !== 'notify') return;

  const message = messages[0];
  if (!message?.message) return;

  const chatId = message.key.remoteJid;
  const senderId = message.key.participant || chatId;
  const isGroup = chatId.endsWith('@g.us');
  const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);

  await handleAutoread(sock, message);
  storeMessage(sock, message);

  const userMessage =
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption ||
    '';

  const text = userMessage.trim().toLowerCase();

  if (!text.startsWith('.')) return;

  // ================= PRESENCE COMMANDS =================

  if (text.startsWith('.alwaysonline')) {
    if (!presenceOnlyOwner(sock, chatId, message, senderIsOwnerOrSudo)) return;
    if (text.includes('on')) {
      presenceSettings.setAlwaysOnline(true);
      presenceSettings.setAutotyping(false);
      presenceSettings.setAutorecording(false);
      await sock.sendMessage(chatId, { text: '✅ Always Online ENABLED' });
    } else if (text.includes('off')) {
      presenceSettings.setAlwaysOnline(false);
      await sock.sendMessage(chatId, { text: '❌ Always Online DISABLED' });
    }
    return;
  }

  if (text.startsWith('.autotyping')) {
    if (!presenceOnlyOwner(sock, chatId, message, senderIsOwnerOrSudo)) return;
    if (text.includes('on')) {
      presenceSettings.setAutotyping(true);
      presenceSettings.setAutorecording(false);
      presenceSettings.setAlwaysOnline(false);
      await sock.sendMessage(chatId, { text: '⌨️ Auto Typing ENABLED' });
    } else if (text.includes('off')) {
      presenceSettings.setAutotyping(false);
      await sock.sendMessage(chatId, { text: '⌨️ Auto Typing DISABLED' });
    }
    return;
  }

  if (text.startsWith('.autorecording')) {
    if (!presenceOnlyOwner(sock, chatId, message, senderIsOwnerOrSudo)) return;
    if (text.includes('on')) {
      presenceSettings.setAutorecording(true);
      presenceSettings.setAutotyping(false);
      presenceSettings.setAlwaysOnline(false);
      await sock.sendMessage(chatId, { text: '🎙️ Auto Recording ENABLED' });
    } else if (text.includes('off')) {
      presenceSettings.setAutorecording(false);
      await sock.sendMessage(chatId, { text: '🎙️ Auto Recording DISABLED' });
    }
    return;
  }

  // ================= COMMAND HANDLER =================

  switch (true) {
    case userMessage === '.simage': {
      const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quotedMessage?.stickerMessage) {
        await simageCommand(sock, quotedMessage, chatId);
      } else {
        await sock.sendMessage(chatId, { text: 'Please reply to a sticker with the .simage command to convert it.' }, { quoted: message });
      }
      break;
    }

    case userMessage.startsWith('.kick'):
      const mentionedJidListKick = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      await kickCommand(sock, chatId, senderId, mentionedJidListKick, message);
      break;

    case userMessage.startsWith('.mute'): {
      const parts = userMessage.trim().split(/\s+/);
      const muteArg = parts[1];
      const muteDuration = muteArg !== undefined ? parseInt(muteArg, 10) : undefined;
      if (muteArg !== undefined && (isNaN(muteDuration) || muteDuration <= 0)) {
        await sock.sendMessage(chatId, { text: 'Please provide a valid number of minutes or use .mute with no number to mute immediately.' }, { quoted: message });
      } else {
        await muteCommand(sock, chatId, senderId, message, muteDuration);
      }
      break;
    }

    case userMessage === '.unmute':
      await unmuteCommand(sock, chatId, senderId);
      break;

    case userMessage.startsWith('.ban'):
      await banCommand(sock, chatId, message);
      break;

    case userMessage.startsWith('.unban'):
      await unbanCommand(sock, chatId, message);
      break;

    case userMessage === '.help' || userMessage === '.menu' || userMessage === '.bot' || userMessage === '.list':
      await helpCommand(sock, chatId, message, global.channelLink);
      break;

    case userMessage === '.sticker' || userMessage === '.s':
      await stickerCommand(sock, chatId, message);
      break;

    case userMessage.startsWith('.warnings'):
      const mentionedJidListWarnings = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      await warningsCommand(sock, chatId, mentionedJidListWarnings);
      break;

    case userMessage.startsWith('.warn'):
      const mentionedJidListWarn = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      await warnCommand(sock, chatId, senderId, mentionedJidListWarn, message);
      break;

    case userMessage.startsWith('.tts'):
      const ttsText = userMessage.slice(4).trim();
      await ttsCommand(sock, chatId, ttsText, message);
      break;

    case userMessage.startsWith('.delete') || userMessage.startsWith('.del'):
      await deleteCommand(sock, chatId, message, senderId);
      break;

    case userMessage.startsWith('.attp'):
      await attpCommand(sock, chatId, message);
      break;

    case userMessage === '.settings':
      await settingsCommand(sock, chatId, message);
      break;

    case userMessage.startsWith('.mode'):
      // Mode handling logic here...
      break;

    case userMessage.startsWith('.anticall'):
      const argsAnticall = userMessage.split(' ').slice(1).join(' ');
      await anticallCommand(sock, chatId, message, argsAnticall);
      break;

    case userMessage.startsWith('.pmblocker'):
      const argsPmblocker = userMessage.split(' ').slice(1).join(' ');
      await pmblockerCommand(sock, chatId, message, argsPmblocker);
      break;

    case userMessage.startsWith('.alwaysonline'): {
      const on = /on\b/i.test(userMessage);
      const off = /off\b/i.test(userMessage);
      const ps = require('./presence_settings');
      if (on || off) {
        ps.setAlwaysOnline(on);
        await sock.sendMessage(chatId, { text: on ? '✅ Always Online enabled.' : '❌ Always Online disabled.' });
      } else {
        await sock.sendMessage(chatId, { text: `Current: ${ps.isAlwaysOnline() ? 'ENABLED' : 'DISABLED'}\nUsage: .alwaysonline on / off` });
      }
      break;
    }

    case userMessage.startsWith('.autorecording'): {
      const on = /on\b/i.test(userMessage);
      const off = /off\b/i.test(userMessage);
      const ps = require('./presence_settings');
      if (on || off) {
        ps.setAutorecording(on);
        await sock.sendMessage(chatId, { text: on ? '✅ Auto Recording enabled.' : '❌ Auto Recording disabled.' });
      } else {
        await sock.sendMessage(chatId, { text: `Current: ${ps.isAutorecording() ? 'ENABLED' : 'DISABLED'}\nUsage: .autorecording on / off` });
      }
      break;
    }

    case userMessage.startsWith('.autotyping'): {
      const on = /on\b/i.test(userMessage);
      const off = /off\b/i.test(userMessage);
      const ps = require('./presence_settings');
      if (on || off) {
        ps.setAutotyping(on);
        await sock.sendMessage(chatId, { text: on ? '✅ Auto Typing enabled.' : '❌ Auto Typing disabled.' });
      } else {
        await sock.sendMessage(chatId, { text: `Current: ${ps.isAutotyping() ? 'ENABLED' : 'DISABLED'}\nUsage: .autotyping on / off` });
      }
      break;
  }
      case userMessage.startsWith('.autotyping'): {
      const on = /on\b/i.test(userMessage);
      const off = /off\b/i.test(userMessage);
      const ps = require('./presence_settings');
      if (on || off) {
        ps.setAutotyping(on);
        await sock.sendMessage(chatId, { text: on ? '✅ Auto Typing enabled.' : '❌ Auto Typing disabled.' });
      } else {
        await sock.sendMessage(chatId, { text: `Current: ${ps.isAutotyping() ? 'ENABLED' : 'DISABLED'}\nUsage: .autotyping on / off` });
      }
      break;
    }
  } // ✅ closes the switch(true) block

} // ✅ closes the handleMessages function
