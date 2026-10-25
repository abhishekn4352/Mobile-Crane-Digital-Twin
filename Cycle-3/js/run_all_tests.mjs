// Run every test file of Cycle 2 and Cycle 3, one after the other, and print one table.
//
//     node Cycle-3/js/run_all_tests.mjs
//
// Run it before every push. Exit code 0 only if every file exits 0.
// The "result" column is read from the file's own summary line; the exit code is what counts.
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, relative, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const folders = [join(repo, 'Cycle-2/js'), here];

const files = folders.flatMap((dir) =>
  readdirSync(dir).filter((f) => /^test_.*\.mjs$/.test(f)).sort().map((f) => join(dir, f)));

function summary(out) {
  let m = out.match(/PASSED\s*:\s*(\d+)[\s\S]*?FAILED\s*:\s*(\d+)/);
  if (m) return `${m[1]} passed, ${m[2]} failed`;
  m = out.match(/(\d+)\s+passed,\s*(\d+)\s+failed/);
  if (m) return `${m[1]} passed, ${m[2]} failed`;
  const lines = out.trim().split('\n').filter(Boolean);
  const pass = lines.filter((l) => /^\s*(PASS|\[PASS\])/.test(l)).length;
  const failLines = lines.filter((l) => /^\s*(FAIL|\[FAIL\])/.test(l)).length;
  return pass || failLines ? `${pass} PASS lines, ${failLines} FAIL lines` : '(no summary line)';
}

let bad = 0;
const width = Math.max(...files.map((f) => relative(repo, f).length));
console.log(`${'test file'.padEnd(width)}  exit  result`);
for (const file of files) {
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', cwd: repo, timeout: 300000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (r.status !== 0) bad++;
  console.log(`${relative(repo, file).padEnd(width)}  ${String(r.status).padEnd(4)}  ${r.status === 0 ? summary(out) : 'FAILED  ' + summary(out) + (/\[FAIL\]|FAIL /.test(out) ? '  (see the [FAIL] lines: run that file alone)' : '  ' + out.trim().split('\n').slice(-1)[0].slice(0, 120))}`);
}
console.log(bad === 0 ? `\nALL ${files.length} TEST FILES PASS` : `\n${bad} of ${files.length} TEST FILES FAIL: do not push`);
process.exit(bad === 0 ? 0 : 1);
