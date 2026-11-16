const fs = require("node:fs");
const path = require("node:path");

function loadDotEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const sharedEnv = {
  NODE_ENV: "production",
  ...loadDotEnv(path.join(__dirname, ".env")),
};

module.exports = {
  apps: [
    {
      name: "life-os-web",
      cwd: path.join(__dirname, "apps/web"),
      script: "pnpm",
      args: "start",
      env: {
        ...sharedEnv,
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
      },
      autorestart: true,
      max_memory_restart: "750M",
    },
    {
      name: "life-os-notifier",
      cwd: path.join(__dirname, "packages/notifier"),
      script: "dist/index.js",
      interpreter: "node",
      env: {
        ...sharedEnv,
      },
      autorestart: true,
      max_memory_restart: "256M",
    },
  ],
};
