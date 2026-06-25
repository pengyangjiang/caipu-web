const fs = require('node:fs');
const vm = require('node:vm');

function loadBrowserExport(filePath, exportName) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    window: {},
    console,
    structuredClone: global.structuredClone,
  };
  vm.runInNewContext(source, sandbox, { filename: filePath });
  const value = sandbox.window[exportName];
  if (value == null) {
    throw new Error(`未在 ${filePath} 中找到 window.${exportName}`);
  }
  return value;
}

module.exports = {
  loadBrowserExport,
};
