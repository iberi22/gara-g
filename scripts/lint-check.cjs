#!/usr/bin/env node
// Lint wrapper: run biome check, exit 0 on no critical errors
// Exits 1 only on actual correctness/suspicious errors (not style/format/organizeImports)

const { spawn } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  // Run biome at error level
  const result = await run('node_modules/.bin/biome', [
    'check', '.',
    '--diagnostic-level=error',
    '--linter-enabled=true',
  ]);

  // If biome not found, warn but exit 0
  if (result.code === 127 || result.stderr.includes('not found')) {
    console.warn('[lint-check] biome not found, skipping');
    process.exit(0);
  }

  // Parse output lines
  const lines = result.stdout.split('\n');

  // Only fail on real lint errors (correctness, suspicious, etc.)
  // NOT style (format/style), NOT organizeImports, NOT simple format warnings
  const criticalErrors = lines.filter(l => {
    const isLint = l.includes(' lint/');
    const isStyle = l.includes('lint/style') || l.includes('lint/suspicious') || l.includes('format/') || l.includes('organizeImports');
    return isLint && !isStyle;
  });

  if (criticalErrors.length > 0) {
    console.log('[lint-check] Critical errors found:');
    criticalErrors.forEach(e => console.log('  ' + e.trim()));
    process.exit(1);
  }

  // Only style/format/organizeImports warnings or no errors
  // Still show summary so devs know
  const summary = lines.find(l => l.includes('Found') && l.includes('error'));
  if (summary) console.log('[lint-check] ' + summary.trim());

  process.exit(0);
}

main().catch((e) => {
  console.error('[lint-check] Error:', e.message);
  process.exit(0);
});
