#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Utility to safely log only if needed
function safeLog(...args) {
  // Comment this out to make completely silent
  // console.log(...args);
}

// Example: Read a file safely
function readFileSafe(filePath) {
  try {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (err) {
    // silently ignore errors
    return null;
  }
}

// Example: Write a file safely
function writeFileSafe(filePath, content) {
  try {
    const fullPath = path.resolve(filePath);
    fs.writeFileSync(fullPath, content, 'utf-8');
    safeLog(`Saved: ${filePath}`);
  } catch (err) {
    // silently ignore errors
  }
}

// Example main function
function main() {
  safeLog('pair.js started');

  // Your actual pairing logic goes here
  const data = readFileSafe('example.txt');
  if (data) {
    safeLog('Read example.txt successfully');
  }

  writeFileSafe('output.txt', 'This is safe content');

  safeLog('pair.js finished');
}

// Run main
main();
