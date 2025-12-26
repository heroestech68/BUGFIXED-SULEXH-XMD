const fs = require('fs');

const path = require('path');

const dataFile = path.join(__dirname, '../data/autorecording.json');

function readState() {

    try {

        return JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

    } catch {

        return { enabled: false };

    }

}

async function autorecordingCommand(sock, chatId, message) {

    const arg = message.message?.conversation?.split(' ')[1];

    const currentState = readState();

    const newState =

        arg === 'on' ? true :

        arg === 'off' ? false :

        !currentState.enabled;

    fs.writeFileSync(dataFile, JSON.stringify({ enabled: newState }, null, 2));

    await sock.sendMessage(chatId, {

        text: `🎙 Autorecording is now *${newState ? 'ON' : 'OFF'}*`

    });

}

const activeIntervals = {};

async function handleAutorecordingForMessage(sock, chatId, message) {

    const state = readState();

    if (!state.enabled) return;

    // Avoid creating multiple intervals for the same chat

    if (activeIntervals[chatId]) return;

    // Immediately send presence once

    try {

        await sock.sendPresenceUpdate('recording', chatId);

    } catch (e) {}

    // Then repeat until JSON = false

    const interval = setInterval(async () => {

        const currentState = readState();

        if (!currentState.enabled) {

            clearInterval(interval);

            delete activeIntervals[chatId];

            return;

        }

        try {

            await sock.sendPresenceUpdate('recording', chatId);

        } catch {}

    }, 5000);

    activeIntervals[chatId] = interval;

}

module.exports = {

    autorecordingCommand,

    handleAutorecordingForMessage

};