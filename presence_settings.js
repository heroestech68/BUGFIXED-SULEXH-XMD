// presence_settings.js
// =======================
// BUGFIXED XMD PRESENCE STATE ENGINE
// =======================

/*
Structure:
{
  "jid@s.whatsapp.net": {
      mode: "online" | "typing" | "recording" | "off"
  }
}
*/

const presenceMap = {}

module.exports = {
    setPresence(jid, mode) {
        if (!jid) return
        presenceMap[jid] = { mode }
    },

    clearPresence(jid) {
        if (!jid) return
        delete presenceMap[jid]
    },

    getPresence(jid) {
        return presenceMap[jid]?.mode || 'off'
    },

    getAll() {
        return presenceMap
    }
}
