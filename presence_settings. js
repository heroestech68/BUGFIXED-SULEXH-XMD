const fs = require('fs');
const path = require('path');

const configPath = path.resolve(__dirname, 'presence-settings.json');

function getDefaults() {
    return {
        alwaysonline: false,
        autotyping: false,
        autorecording: false
    };
}

function readSettings() {
    try {
        if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify(getDefaults(), null, 2));
        const data = JSON.parse(fs.readFileSync(configPath));
        return { ...getDefaults(), ...data };
    } catch (e) {
        return getDefaults();
    }
}

function writeSettings(newValues) {
    const current = readSettings();
    const data = { ...current, ...newValues };
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
    return data;
}

function setPresence(key, value) {
    writeSettings({ [key]: value });
}

module.exports = {
    getPresenceSettings: readSettings,
    setPresence,
    isAlwaysOnline: () => readSettings().alwaysonline,
    isAutotyping: () => readSettings().autotyping,
    isAutorecording: () => readSettings().autorecording,
    setAlwaysOnline: v => setPresence('alwaysonline', v),
    setAutotyping: v => setPresence('autotyping', v),
    setAutorecording: v => setPresence('autorecording', v),
    configPath
};
