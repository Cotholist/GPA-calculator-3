const fs = require('fs-extra');
const path = require('path');

// 确保 dist 目录存在并为空
fs.emptyDirSync(path.join(__dirname, 'dist'));

// 复制 src 目录到 dist
fs.copySync(path.join(__dirname, 'src'), path.join(__dirname, 'dist'));
