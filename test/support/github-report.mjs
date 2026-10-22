// A node:test reporter for GitHub Actions: a results table and every failure (with its message)
// on the run's summary page, and each failure as an error annotation on the test that failed, so
// it shows on the pull request's Files tab. Used beside the usual spec output by `npm run test:ci`
// (and the Stream Deck plugin's), e.g.
//   node --test --test-reporter=spec --test-reporter-destination=stdout \
//     --test-reporter=./test/support/github-report.mjs --test-reporter-destination=stdout test/*.test.js
// Outside GitHub Actions (no GITHUB_STEP_SUMMARY) it prints the same Markdown instead.
// TEST_REPORT_TITLE names the section (default "Tests"), so two test runs on one summary page stay apart.
import fs from 'node:fs';
import path from 'node:path';

const TITLE = process.env.TEST_REPORT_TITLE || 'Tests';
const MAX_MESSAGE = 4000;

const relative = file => {
  if (!file) return '';
  const p = file.startsWith('file://') ? new URL(file).pathname : file;
  return path.relative(process.cwd(), p).split(path.sep).join('/');
};
// Annotation paths are from the repository root, which isn't the working folder for the plugin.
const fromRepoRoot = file => {
  const p = file.startsWith('file://') ? new URL(file).pathname : file;
  const root = process.env.GITHUB_WORKSPACE || process.cwd();
  return path.relative(root, p).split(path.sep).join('/');
};
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeCell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
// Workflow command values: % \r \n escaped, and in properties also : and ,
const escapeData = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProp = s => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const seconds = ms => `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;

function messageOf(error) {
  let e = error;
  // node:test wraps what a test threw; the real error is its cause.
  while (e && e.code === 'ERR_TEST_FAILURE' && e.cause) e = e.cause;
  if (!e) return 'failed';
  // The diff says it all for an assertion; elsewhere keep the stack, less node's own frames.
  const text = e.name === 'AssertionError' || !e.stack
    ? `${e.name || 'Error'}: ${e.message ?? e}`
    : e.stack.split('\n').filter(l => !/\(node:|at node:/.test(l)).join('\n');
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}\n…` : text;
}

export default async function* githubReport(source) {
  const started = Date.now();
  const stacks = new Map();   // file -> names of the tests/suites currently open, by nesting
  const files = new Map();    // file -> { passed, failed, skipped, ms }
  const failures = [];
  const totals = { passed: 0, failed: 0, skipped: 0, todo: 0 };

  const fileRow = file => {
    if (!files.has(file)) files.set(file, { passed: 0, failed: 0, skipped: 0, ms: 0, tests: [] });
    return files.get(file);
  };

  for await (const { type, data } of source) {
    if (type === 'test:start') {
      const stack = stacks.get(data.file) || [];
      stack[data.nesting] = data.name;
      stack.length = data.nesting + 1;
      stacks.set(data.file, stack);
      continue;
    }
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    const file = relative(data.file);
    const names = (stacks.get(data.file) || []).slice(0, data.nesting).concat(data.name);
    // A file that runs as a whole shows up as a test named after its own path; don't repeat it.
    const fullName = names.filter(n => relative(n) !== file).join(' › ') || file;
    const details = data.details || {};
    const isSuite = details.type === 'suite';
    const row = fileRow(file);
    if (data.nesting === 0) row.ms += details.duration_ms || 0;

    if (type === 'test:pass') {
      if (isSuite) continue;
      if (data.todo) { totals.todo++; row.tests.push(['📝', fullName, details.duration_ms]); }
      else if (data.skip) { totals.skipped++; row.skipped++; row.tests.push(['⏭️', fullName, details.duration_ms]); }
      else { totals.passed++; row.passed++; row.tests.push(['✅', fullName, details.duration_ms]); }
      continue;
    }
    // A suite fails because a test in it failed (already counted) or because of its own hooks.
    if (isSuite && details.error && details.error.failureType === 'subtestsFailed') continue;
    if (data.todo) { totals.todo++; continue; }
    // Tests that never ran because their suite's hook failed: the suite's failure says why.
    if (details.error && details.error.failureType === 'cancelledByParent') continue;
    totals.failed++;
    row.failed++;
    row.tests.push(['❌', fullName, details.duration_ms]);
    const message = messageOf(details.error);
    failures.push({ file, line: data.line, column: data.column, name: fullName, message });
    if (data.file && process.env.GITHUB_ACTIONS) {
      const where = [`file=${escapeProp(fromRepoRoot(data.file))}`];
      if (data.line) where.push(`line=${data.line}`);
      if (data.column) where.push(`col=${data.column}`);
      where.push(`title=${escapeProp(`${TITLE}: ${fullName}`)}`);
      yield `::error ${where.join(',')}::${escapeData(message)}\n`;
    }
  }

  const ms = Date.now() - started;
  const ok = totals.failed === 0;
  const counts = [`${totals.passed} passed`];
  if (totals.failed) counts.push(`${totals.failed} failed`);
  if (totals.skipped) counts.push(`${totals.skipped} skipped`);
  if (totals.todo) counts.push(`${totals.todo} to do`);

  const md = [];
  md.push(`## ${ok ? '✅' : '❌'} ${TITLE}: ${counts.join(', ')} in ${seconds(ms)}`, '');
  if (failures.length) {
    md.push('### Failed', '');
    for (const f of failures) {
      md.push(`<details open><summary>❌ <b>${escapeHtml(f.name)}</b> <code>${escapeHtml(f.file)}${f.line ? `:${f.line}` : ''}</code></summary>`, '');
      md.push('```', f.message.replace(/```/g, "'''"), '```', '</details>', '');
    }
  }
  md.push(`<details><summary>Results by file</summary>`, '');
  md.push('| File | Passed | Failed | Skipped | Time |', '| --- | ---: | ---: | ---: | ---: |');
  for (const [file, r] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    md.push(`| ${r.failed ? '❌' : '✅'} ${escapeCell(file)} | ${r.passed} | ${r.failed || ''} | ${r.skipped || ''} | ${seconds(r.ms)} |`);
  }
  md.push('', '</details>', '');
  md.push('<details><summary>Every test</summary>', '');
  for (const [file, r] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    md.push(`**${escapeHtml(file)}**`, '');
    for (const [mark, name, took] of r.tests) md.push(`- ${mark} ${escapeHtml(name)} (${seconds(took || 0)})`);
    md.push('');
  }
  md.push('</details>', '');
  const text = md.join('\n') + '\n';

  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else yield `\n${text}`;
}
