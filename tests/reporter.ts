import { basename } from 'node:path';
import type {
  FullConfig,
  Reporter,
  Suite,
  TestCase,
  TestResult
} from '@playwright/test/reporter';

const useColor = process.env.NO_COLOR === undefined;
const green = (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);

function shortName(file: string): string {
  return basename(file).replace(/\.e2e\.ts$/, '');
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default class ShortListReporter implements Reporter {
  private passed = 0;
  private failed = 0;
  private fileColWidth = 0;

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
    else this.failed++;
    const mark = ok ? green('✓') : red('✘');
    const file = dim(shortName(test.location.file).padEnd(this.fileColWidth));
    const dur = dim(`(${formatDuration(result.duration)})`);
    process.stdout.write(`  ${file} ${mark} ${test.title} ${dur}\n`);
  }

  onEnd() {
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
