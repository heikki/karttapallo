import { basename } from 'node:path';
import type {
  FullConfig,
  Reporter,
  Suite,
  TestCase,
  TestResult
} from '@playwright/test/reporter';

const useColor = process.env.NO_COLOR === undefined;
function green(s: string) {
  return useColor ? `\x1b[32m${s}\x1b[0m` : s;
}
function red(s: string) {
  return useColor ? `\x1b[31m${s}\x1b[0m` : s;
}
function dim(s: string) {
  return useColor ? `\x1b[2m${s}\x1b[0m` : s;
}

function shortName(file: string) {
  return basename(file).replace(/\.e2e\.ts$/, '');
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * How much of a failure's message to reprint. Playwright's messages carry a
 * matcher diff and a source excerpt; the first lines are the part that says
 * what went wrong, and the trace below covers anything deeper.
 */
const ERROR_LINES = 20;

/**
 * Reprint a failure at the bottom of the run. The inline ✘ is a line in a list
 * dozens long — by the time the run ends it has scrolled off, which left a
 * failed run saying only how many failed and not which or why.
 */
function writeFailure(
  entry: { test: TestCase; result: TestResult },
  index: number
) {
  const { test, result } = entry;
  const where = `${shortName(test.location.file)}:${test.location.line}`;
  const attempt = result.retry === 0 ? '' : dim(` (retry ${result.retry})`);
  process.stdout.write(
    `\n  ${red(`${index + 1}) ${test.title}`)} ${dim(where)}${attempt}\n`
  );

  for (const err of result.errors) {
    const message = (err.message ?? err.value ?? '').trimEnd();
    if (message === '') continue;
    const lines = message.split('\n');
    for (const line of lines.slice(0, ERROR_LINES)) {
      process.stdout.write(`     ${line}\n`);
    }
    if (lines.length > ERROR_LINES) {
      const rest = lines.length - ERROR_LINES;
      process.stdout.write(dim(`     … ${rest} more lines\n`));
    }
  }

  // The trace is already retained (`trace: 'retain-on-failure'`); naming the
  // command is what makes it reachable without going and looking for it.
  const trace = result.attachments.find((a) => a.name === 'trace');
  if (trace?.path !== undefined) {
    process.stdout.write(dim(`     npx playwright show-trace ${trace.path}\n`));
  }
}

export default class ShortListReporter implements Reporter {
  private passed = 0;
  private failed = 0;
  private fileColWidth = 0;
  private readonly failures: Array<{ test: TestCase; result: TestResult }> = [];

  onBegin(_config: FullConfig, suite: Suite) {
    const widths = suite
      .allTests()
      .map((t) => shortName(t.location.file).length);
    this.fileColWidth = widths.length === 0 ? 0 : Math.max(...widths);
    process.stdout.write('\n');
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const ok = result.status === 'passed';
    if (ok) this.passed++;
    else {
      this.failed++;
      this.failures.push({ test, result });
    }
    const mark = ok ? green('✓') : red('✘');
    const file = dim(shortName(test.location.file).padEnd(this.fileColWidth));
    const dur = dim(`(${formatDuration(result.duration)})`);
    process.stdout.write(`  ${file} ${mark} ${test.title} ${dur}\n`);
  }

  onEnd() {
    this.failures.forEach((entry, i) => {
      writeFailure(entry, i);
    });
    const summary =
      this.failed === 0
        ? green(`${this.passed} passed`)
        : `${green(`${this.passed} passed`)}, ${red(`${this.failed} failed`)}`;
    // Trailing blank when failing so bun's "error: script ... exited with
    // code 1" doesn't visually butt against the summary.
    const trailer = this.failed === 0 ? '' : '\n';
    process.stdout.write(`\n  ${summary}\n${trailer}`);
  }
}
