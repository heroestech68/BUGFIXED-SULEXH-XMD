const fs = require('fs');
const path = require('path');

function loadCommands() {
    const commands = {};
    const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== 'index.js');

    for (const file of files) {
        const cmd = require(path.join(__dirname, file));
        if (cmd.name) commands[cmd.name] = cmd;
        if (cmd.aliases) {
            for (const a of cmd.aliases) commands[a] = cmd;
        }
    }
    return commands;
}

function getCommand(commands, name) {
    return commands[name];
}

module.exports = { loadCommands, getCommand };
