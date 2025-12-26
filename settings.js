const settings = {
  packname: process.env.PACKNAME || 'Bugfixed sulexh xmd',
  author: process.env.AUTHOR || '‎',
  botName: process.env.BOT_NAME || 'bugfixed xmd Bot',
  botOwner: process.env.BOT_OWNER || 'Bugfixed',
  ownerNumber: process.env.OWNER_NUMBER || '254768161116',

  giphyApiKey: process.env.GIPHY_API_KEY || 'qnl7ssQChTdPjsKta2Ax2LMaGXz303tq',

  commandMode: process.env.MODE || 'public',

  maxStoreMessages: 20,
  storeWriteInterval: 10000,

  description: 'This is a bot for managing group commands and automating tasks.',
  version: '3.0.5',

  updateZipUrl:
    'https://github.com/heroestech68/BUGFIXED-SULEXH-XMD/archive/refs/heads/main.zip',
};

module.exports = settings;
