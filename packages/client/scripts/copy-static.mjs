// 把静态资源复制到 dist，并给资源引用注入版本指纹（防缓存）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

fs.mkdirSync(dist, { recursive: true });

// 从 src/version.ts 读取版本号（单一权威来源）
const versionSrc = fs.readFileSync(path.join(root, "src/version.ts"), "utf8");
const m = versionSrc.match(/export const VERSION = "([^"]+)"/);
const version = m ? m[1] : "0.0.0";
console.log(`build version: ${version}`);

for (const f of ["style.css"]) {
  const src = path.join(root, f);
  const dst = path.join(dist, f);
  fs.copyFileSync(src, dst);
  console.log(`copied ${f} -> dist/`);
}

// index.html 注入版本指纹（?v=版本号），强制浏览器拉取新版本
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
html = html.replace('href="./style.css"', `href="./style.css?v=${version}"`);
html = html.replace('src="./main.js"', `src="./main.js?v=${version}"`);
html = html.replace('"@tank/shared": "/vendor/shared/index.js"', `"@tank/shared": "/vendor/shared/index.js?v=${version}"`);
fs.writeFileSync(path.join(dist, "index.html"), html);
console.log("copied index.html -> dist/ (version-fingerprinted)");

// 复制 shared 编译产物到 dist/vendor/shared，供浏览器 importmap 使用
const sharedDist = path.resolve(root, "../shared/dist");
const vendorDir = path.join(dist, "vendor/shared");
if (fs.existsSync(sharedDist)) {
  fs.mkdirSync(vendorDir, { recursive: true });
  copyDir(sharedDist, vendorDir);
  console.log("copied shared dist -> dist/vendor/shared/");
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
