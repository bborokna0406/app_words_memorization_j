import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.dirname(fileURLToPath(import.meta.url));
const apps = [
  { root: "azerbaijani_words", packages: "updates", prefix: "v" },
  { root: "english_words", packages: "update_packages", prefix: "v" },
  { root: "japanese_words", packages: "updates", prefix: "" },
  { root: "chinese_words", packages: "updates", prefix: "" },
];

const requiredFiles = [
  "index.html",
  "styles.css",
  "word-store.js",
  "app.js",
  "sw.js",
  "version.json",
  "manifest.webmanifest",
  "assets/app-mark.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
];

const failures = [];

function fail(directory, message) {
  failures.push(`${path.relative(workspace, directory)}: ${message}`);
}

function localReferences(source, pattern) {
  return Array.from(source.matchAll(pattern), (match) => match[1])
    .filter((reference) => !/^(?:[a-z]+:|#|data:)/i.test(reference))
    .map((reference) => reference.split(/[?#]/, 1)[0].replace(/^\.\//, ""));
}

function checkReference(directory, reference, sourceName) {
  if (!reference) return;
  const target = path.resolve(directory, reference);
  if (!target.startsWith(`${directory}${path.sep}`) || !fs.existsSync(target)) {
    fail(directory, `${sourceName} references missing file ${reference}`);
  }
}

function verifyDirectory(directory, expectedVersion) {
  requiredFiles.forEach((file) => {
    const target = path.join(directory, file);
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
      fail(directory, `missing required file ${file}`);
    }
  });

  if (!fs.existsSync(path.join(directory, "index.html"))) return;

  try {
    const version = JSON.parse(fs.readFileSync(path.join(directory, "version.json"), "utf8"));
    if (version.version !== expectedVersion) {
      fail(directory, `version.json is ${version.version}, expected ${expectedVersion}`);
    }
  } catch (error) {
    fail(directory, `invalid version.json (${error.message})`);
  }

  try {
    JSON.parse(fs.readFileSync(path.join(directory, "manifest.webmanifest"), "utf8"));
  } catch (error) {
    fail(directory, `invalid manifest.webmanifest (${error.message})`);
  }

  for (const file of ["word-store.js", "app.js", "sw.js"]) {
    const target = path.join(directory, file);
    if (!fs.existsSync(target)) continue;
    const source = fs.readFileSync(target, "utf8");
    try {
      new Function(source);
    } catch (error) {
      fail(directory, `${file} has invalid JavaScript (${error.message})`);
    }
  }

  const html = fs.readFileSync(path.join(directory, "index.html"), "utf8");
  localReferences(html, /(?:src|href)="([^"]+)"/g)
    .forEach((reference) => checkReference(directory, reference, "index.html"));

  const storeScript = html.indexOf('src="word-store.js"');
  const appScript = html.indexOf('src="app.js"');
  if (storeScript < 0 || appScript < 0 || storeScript > appScript) {
    fail(directory, "word-store.js must load before app.js");
  }

  const appSource = fs.readFileSync(path.join(directory, "app.js"), "utf8");
  const appVersion = appSource.match(/const APP_VERSION = "([^"]+)"/)?.[1];
  if (appVersion !== expectedVersion) {
    fail(directory, `app.js version is ${appVersion}, expected ${expectedVersion}`);
  }
  if (!appSource.includes("window.createWordStore")) {
    fail(directory, "app.js does not use an explicit word store reference");
  }

  const worker = fs.readFileSync(path.join(directory, "sw.js"), "utf8");
  localReferences(worker, /"\.\/([^"]+)"/g)
    .forEach((reference) => checkReference(directory, reference, "sw.js"));
}

for (const app of apps) {
  const root = path.join(workspace, app.root);
  const version = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf8")).version;
  verifyDirectory(root, version);

  const packageDirectory = path.join(root, app.packages, `${app.prefix}${version}`);
  if (!fs.existsSync(packageDirectory)) {
    fail(packageDirectory, "latest update package is missing");
  } else {
    verifyDirectory(packageDirectory, version);
    requiredFiles.forEach((file) => {
      const rootFile = path.join(root, file);
      const packageFile = path.join(packageDirectory, file);
      if (fs.existsSync(rootFile) && fs.existsSync(packageFile)
        && !fs.readFileSync(rootFile).equals(fs.readFileSync(packageFile))) {
        fail(packageDirectory, `${file} does not match the app root`);
      }
    });
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("All app roots and latest update packages are deploy-ready.");
}
