const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 检查是否安装了 javascript-obfuscator
try {
  require.resolve('javascript-obfuscator');
} catch (e) {
  console.log('正在安装 javascript-obfuscator...');
  execSync('npm init -y', { stdio: 'inherit' });
  execSync('npm install javascript-obfuscator --save-dev', { stdio: 'inherit' });
}

const JavaScriptObfuscator = require('javascript-obfuscator');

const sourceDir = path.join(__dirname, 'dist_b488693');
const outputDir = path.join(__dirname, 'dist_b488693_obfuscated');

const jsFiles = [
  'auth.js',
  'background.js',
  'content-iframe.js',
  'content.js',
  'offscreen.js',
  'popup.js'
];

function copyFile(source, destination) {
  const destDir = path.dirname(destination);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(source, destination);
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true });
  }
  
  const entries = fs.readdirSync(source, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);
    
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('开始混淆插件...\n');
console.log(`源目录: ${sourceDir}`);
console.log(`输出目录: ${outputDir}\n`);

if (!fs.existsSync(sourceDir)) {
  console.error(`错误: 源目录不存在: ${sourceDir}`);
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`已创建输出目录: ${outputDir}\n`);
}

copyDirectory(path.join(sourceDir, 'icons'), path.join(outputDir, 'icons'));
console.log('✓ 已复制 icons 目录');

copyDirectory(path.join(sourceDir, 'sounds'), path.join(outputDir, 'sounds'));
console.log('✓ 已复制 sounds 目录');

const otherFiles = ['manifest.json', 'offscreen.html', 'popup.html'];
otherFiles.forEach((file) => {
  const srcPath = path.join(sourceDir, file);
  const destPath = path.join(outputDir, file);
  if (fs.existsSync(srcPath)) {
    copyFile(srcPath, destPath);
    console.log(`✓ 已复制: ${file}`);
  }
});

console.log('\n开始混淆 JavaScript 文件...\n');

jsFiles.forEach((file) => {
  const srcPath = path.join(sourceDir, file);
  const destPath = path.join(outputDir, file);
  
  if (fs.existsSync(srcPath)) {
    try {
      const originalCode = fs.readFileSync(srcPath, 'utf8');
      
      const obfuscationResult = JavaScriptObfuscator.obfuscate(originalCode, {
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        disableConsoleOutput: false,
        identifierNamesGenerator: 'hexadecimal',
        log: false,
        numbersToExpressions: false,
        renameGlobals: false,
        selfDefending: false,
        simplify: true,
        splitStrings: false,
        stringArray: true,
        stringArrayCallsTransform: false,
        stringArrayEncoding: ['base64'],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 1,
        stringArrayWrappersChainedCalls: true,
        stringArrayWrappersParametersMaxCount: 2,
        stringArrayWrappersType: 'function',
        stringArrayThreshold: 0.5,
        transformObjectKeys: false,
        unicodeEscapeSequence: false
      });
      
      fs.writeFileSync(destPath, obfuscationResult.getObfuscatedCode());
      console.log(`✓ 已混淆: ${file}`);
    } catch (error) {
      console.error(`✗ 混淆失败: ${file}`);
      console.error('  错误:', error.message);
    }
  } else {
    console.log(`⚠ 文件不存在，跳过: ${file}`);
  }
});

const otherJsFiles = ['5555.js'];
otherJsFiles.forEach((file) => {
  const srcPath = path.join(sourceDir, file);
  const destPath = path.join(outputDir, file);
  if (fs.existsSync(srcPath)) {
    copyFile(srcPath, destPath);
    console.log(`✓ 已复制（非混淆）: ${file}`);
  }
});

console.log('\n混淆完成！');
console.log(`混淆后的插件位于: ${outputDir}`);
