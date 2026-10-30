const { execSync } = require('node:child_process');

const attempts = 4;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    execSync('npx prisma db push', { stdio: 'inherit' });
    process.exit(0);
  } catch {
    if (attempt === attempts) {
      console.error(`prisma db push failed after ${attempts} attempts.`);
      process.exit(1);
    }
    const waitMs = attempt * 5000;
    console.error(`Neon closed the connection (attempt ${attempt} of ${attempts}). Retrying in ${waitMs / 1000}s.`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  }
}
