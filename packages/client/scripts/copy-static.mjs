// 把静态资源复制到 dist
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

fs.mkdirSync(dist, { recursive: true });

for (const f of ["index.html", "style.css"]) {
  const src = path.join(root, f);
  const dst = path.join(dist, f);
  fs.copyFileSync(src, dst);
  console.log(`copied ${f} -> dist/`);
}

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
