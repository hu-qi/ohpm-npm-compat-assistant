const fs = require('fs');
const { exec: run } = require('child_process');

fs.promises.readFile('a.txt');
run('echo hi');
window.localStorage.getItem('k');
new WebSocket('wss://example.com/socket');
