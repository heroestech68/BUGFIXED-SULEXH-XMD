const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
            if (err) return reject(new Error((stderr || stdout || err.message || '').toString()));
            resolve((stdout || '').toString());
        });
    });
}

async function hasGitRepo() {
    if (!fs.existsSync(path.join(process.cwd(), '.git'))) return false;
    try {
        await run('git --version');
        return true;
    } catch {
        return false;
    }
}

// 🔴 FORCE ORIGIN TO YOUR REPO
async function ensureCorrectOrigin() {
    const repoUrl = (settings.repoUrl || process.env.GIT_REPO_URL || '').trim();
    if (!repoUrl) throw new Error('repoUrl not set in settings.js');

    try {
        await run('git remote get-url origin');
        await run(`git remote set-url origin ${repoUrl}`);
    } catch {
        await run(`git remote add origin ${repoUrl}`);
    }
}

// 🔴 AUTO-DETECT DEFAULT BRANCH
async function detectBranch() {
    try {
        const ref = await run('git symbolic-ref refs/remotes/origin/HEAD');
        return ref.trim().replace('refs/remotes/origin/', '');
    } catch {
        return 'main';
    }
}

async function updateViaGit() {
    await ensureCorrectOrigin();
    const branch = await detectBranch();

    const oldRev = (await run('git rev-parse HEAD').catch(() => 'unknown')).trim();
    await run('git fetch origin --prune');
    const newRev = (await run(`git rev-parse origin/${branch}`)).trim();

    if (oldRev === newRev) {
        return { alreadyUpToDate: true, newRev };
    }

    await run(`git reset --hard ${newRev}`);
    await run('git clean -fd');
    await run('npm install --no-audit --no-fund');

    return { alreadyUpToDate: false, newRev };
}

async function restartProcess(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { text: '✅ Update complete. Restarting…' }, { quoted: message });
    } catch {}

    try {
        await run('pm2 restart all');
    } catch {
        setTimeout(() => process.exit(0), 500);
    }
}

async function updateCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

    if (!message.key.fromMe && !isOwner) {
        await sock.sendMessage(chatId, { text: '❌ Only owner or sudo can use .update' }, { quoted: message });
        return;
    }

    try {
        await sock.sendMessage(chatId, { text: '🔄 Updating from your repository…' }, { quoted: message });

        if (!(await hasGitRepo())) {
            throw new Error('No git repository found. ZIP update not configured.');
        }

        const { alreadyUpToDate, newRev } = await updateViaGit();

        await sock.sendMessage(chatId, {
            text: alreadyUpToDate
                ? `✅ Already up to date\n${newRev}`
                : `✅ Updated successfully\n${newRev}`
        }, { quoted: message });

        await restartProcess(sock, chatId, message);

    } catch (err) {
        console.error('Update failed:', err);
        await sock.sendMessage(chatId, {
            text: `❌ Update failed:\n${err.message}`
        }, { quoted: message });
    }
}

module.exports = updateCommand;
