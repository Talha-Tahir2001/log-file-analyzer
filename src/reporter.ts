import chalk from "chalk";
import Table from "cli-table3";
import { AnalysisResult, EndpointStats, LogEntry } from "./types";

function fmt(n: number | null, unit = "ms"): string {
    if (n === null) return chalk.dim("N/A");
    if (unit === "ms" && n >= 1000) {
        return (n / 1000).toFixed(2) + "s";
    }
    return `${n.toLocaleString()}${unit}`;
}

function fmtPct(rate: number): string {
    const pct = (rate * 100).toFixed(1);
    if (rate >= 0.5) return chalk.red(`${pct}%`);
    if (rate >= 0.2) return chalk.yellow(`${pct}%`);
    return chalk.green(`${pct}%`);
}

function statusColor(code: number | null): string {
    if (code === null) return chalk.dim("???");
    if (code >= 500) return chalk.bgRed.white(` ${code} `);
    if (code >= 400) return chalk.red(`${code}`);
    if (code >= 300) return chalk.cyan(`${code}`);
    return chalk.green(`${code}`);
}

function bar(value: number, max: number, width = 20): string {
    const filled = Math.round((value / max) * width);
    return chalk.blue("█".repeat(filled)) + chalk.dim("░".repeat(width - filled));
}

function divider(char = "─", width = 80): string {
    return chalk.dim(char.repeat(width));
}

function section(title: string): void {
    console.log("");
    console.log(chalk.bold.white(`  ${title}`));
    console.log(divider());
}

function msToHuman(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
    return `${(ms / 86_400_000).toFixed(1)}d`;
}

function printHeader(filePath: string, result: AnalysisResult): void {
    const { parseResult, timeSpanMs } = result;
    const validCount = parseResult.entries.length;
    const malformedCount = parseResult.malformed.length;
    const total = parseResult.totalLines;
    const malformedPct =
        total > 0 ? ((malformedCount / total) * 100).toFixed(1) : "0.0";

    console.log('');
    console.log(chalk.bold.bgWhite.black('                                                  '));
    console.log(chalk.bold.bgWhite.black('   LOG ANALYZER                                   '));
    console.log(chalk.bold.bgWhite.black('                                                  '));
    console.log('');
    console.log(`  ${chalk.dim('File')}      ${chalk.white(filePath)}`);
    if (timeSpanMs !== null) {
        const oldest = new Date(Math.min(...result.parseResult.entries.map(e => e.timestamp.getTime())));
        const newest = new Date(Math.max(...result.parseResult.entries.map(e => e.timestamp.getTime())));
        console.log(`  ${chalk.dim('Span')}      ${oldest.toISOString().slice(0, 19)}Z → ${newest.toISOString().slice(0, 19)}Z  ${chalk.dim(`(${msToHuman(timeSpanMs)})`)}`);
    }
    console.log('');
    console.log(
        `  ${chalk.bold(total.toLocaleString())} total lines  ` +
        `${chalk.green(validCount.toLocaleString())} parsed  ` +
        `${malformedCount > 0 ? chalk.yellow(malformedCount.toLocaleString()) : chalk.dim('0')} malformed ${chalk.dim(`(${malformedPct}%)`)}  ` +
        `${parseResult.blankLines > 0 ? chalk.dim(`${parseResult.blankLines} blank`) : ''}`
    );
    console.log('');
}

function printStatusDistribution(result: AnalysisResult): void {
    section('STATUS CODE DISTRIBUTION');

    const maxCount = Math.max(...result.statusDistribution.map(b => b.count));

    for (const bucket of result.statusDistribution) {
        const pct = ((bucket.count / result.parseResult.entries.length) * 100).toFixed(1);
        const labelPad = bucket.label.padEnd(20);
        console.log(
            `  ${chalk.bold(labelPad)}  ` +
            `${bar(bucket.count, maxCount, 24)}  ` +
            `${bucket.count.toLocaleString().padStart(7)} ${chalk.dim(`(${pct}%)`)}`
        );
    }
}

function printSlowestEndpoints(result: AnalysisResult): void {
  section('SLOWEST ENDPOINTS  (by p95 response time, min 5 requests)');
 
  const qualified = result.endpointStats
    .filter(e => e.p95ResponseMs !== null && e.count >= 5)
    .sort((a, b) => (b.p95ResponseMs ?? 0) - (a.p95ResponseMs ?? 0))
    .slice(0, 10);
 
  if (qualified.length === 0) {
    console.log(chalk.dim('  Not enough data.'));
    return;
  }
 
  const t = new Table({
    head: [
      chalk.bold('Method'),
      chalk.bold('Path'),
      chalk.bold('Requests'),
      chalk.bold('Avg'),
      chalk.bold('p95'),
      chalk.bold('p99'),
      chalk.bold('Max'),
      chalk.bold('Err%'),
    ],
    style: { head: [], border: ['dim'] },
    colAligns: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
  });
 
  for (const e of qualified) {
    t.push([
      chalk.cyan(e.method),
      e.path.length > 40 ? e.path.slice(0, 37) + '…' : e.path,
      e.count.toLocaleString(),
      fmt(e.avgResponseMs),
      chalk.yellow(fmt(e.p95ResponseMs)),
      fmt(e.p99ResponseMs),
      chalk.red(fmt(e.maxResponseMs)),
      fmtPct(e.errorRate),
    ]);
  }
 
  console.log(t.toString());
}

function printErrorEndpoints(result: AnalysisResult): void {
  section('HIGHEST ERROR RATE ENDPOINTS  (min 5 requests, any 4xx/5xx)');
 
  const qualified = result.endpointStats
    .filter(e => e.errorCount > 0 && e.count >= 5)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10);
 
  if (qualified.length === 0) {
    console.log(chalk.dim('  No endpoint errors detected.'));
    return;
  }
 
  const t = new Table({
    head: [
      chalk.bold('Method'),
      chalk.bold('Path'),
      chalk.bold('Requests'),
      chalk.bold('Errors'),
      chalk.bold('Error Rate'),
      chalk.bold('p95'),
    ],
    style: { head: [], border: ['dim'] },
    colAligns: ['left', 'left', 'right', 'right', 'right', 'right'],
  });
 
  for (const e of qualified) {
    t.push([
      chalk.cyan(e.method),
      e.path.length > 45 ? e.path.slice(0, 42) + '…' : e.path,
      e.count.toLocaleString(),
      chalk.red(e.errorCount.toLocaleString()),
      fmtPct(e.errorRate),
      fmt(e.p95ResponseMs),
    ]);
  }
 
  console.log(t.toString());
}

function printTopIps(result: AnalysisResult): void {
  section('TOP IPs BY REQUEST COUNT');
 
  const t = new Table({
    head: [
      chalk.bold('IP Address'),
      chalk.bold('Requests'),
      chalk.bold('Errors'),
      chalk.bold('Err%'),
      chalk.bold('Unique Paths'),
    ],
    style: { head: [], border: ['dim'] },
    colAligns: ['left', 'right', 'right', 'right', 'right'],
  });
 
  for (const ip of result.topIps) {
    t.push([
      ip.ip,
      ip.count.toLocaleString(),
      ip.errorCount > 0 ? chalk.red(ip.errorCount.toLocaleString()) : chalk.dim('0'),
      fmtPct(ip.count > 0 ? ip.errorCount / ip.count : 0),
      ip.uniquePaths.toLocaleString(),
    ]);
  }
 
  console.log(t.toString());
}

function printSlowestRequests(result: AnalysisResult): void {
  section('10 SLOWEST INDIVIDUAL REQUESTS');
 
  const t = new Table({
    head: [
      chalk.bold('#'),
      chalk.bold('Response Time'),
      chalk.bold('Status'),
      chalk.bold('Method'),
      chalk.bold('Path'),
      chalk.bold('IP'),
      chalk.bold('Timestamp'),
    ],
    style: { head: [], border: ['dim'] },
    colAligns: ['right', 'right', 'right', 'left', 'left', 'left', 'left'],
  });
 
  result.slowestRequests.forEach((e, i) => {
    t.push([
      chalk.dim(String(i + 1)),
      chalk.red(fmt(e.responseTimeMs)),
      statusColor(e.statusCode),
      chalk.cyan(e.method),
      e.path.length > 40 ? e.path.slice(0, 37) + '…' : e.path,
      chalk.dim(e.ip),
      chalk.dim(e.timestamp.toISOString().slice(0, 19) + 'Z'),
    ]);
  });
 
  console.log(t.toString());
}

function printTimeSeries(result: AnalysisResult): void {
  const { timeSeries, granularity } = result;
  if (timeSeries.length === 0) return;
 
  section(`REQUEST VOLUME OVER TIME  (per ${granularity})`);
 
  const maxCount = Math.max(...timeSeries.map(b => b.count));
  const buckets = timeSeries.length > 40
    ? timeSeries.filter((_, i) => i % Math.ceil(timeSeries.length / 40) === 0)
    : timeSeries;
 
  for (const b of buckets) {
    const label = b.bucket.slice(0, granularity === 'day' ? 10 : 16).replace('T', ' ');
    const errorShare = b.count > 0 ? b.errorCount / b.count : 0;
    const filled = Math.round((b.count / maxCount) * 30);
    const errFilled = Math.round(errorShare * filled);
    const okFilled = filled - errFilled;
 
    const barStr = chalk.green('█'.repeat(okFilled)) + chalk.red('█'.repeat(errFilled)) + chalk.dim('░'.repeat(30 - filled));
    console.log(`  ${chalk.dim(label)}  ${barStr}  ${b.count.toLocaleString().padStart(6)}`);
  }
}

function printMalformed(result: AnalysisResult): void {
  const { malformed } = result.parseResult;
  if (malformed.length === 0) return;
 
  section(`MALFORMED LINES  (${malformed.length.toLocaleString()} total — showing first 5)`);
 
  // Group by reason
  const byReason = new Map<string, number>();
  for (const m of malformed) {
    byReason.set(m.reason, (byReason.get(m.reason) ?? 0) + 1);
  }
  for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${chalk.yellow(count.toString().padStart(6))}  ${reason}`);
  }
 
  console.log('');
  for (const m of malformed.slice(0, 5)) {
    const preview = m.raw.length > 100 ? m.raw.slice(0, 97) + '…' : m.raw;
    console.log(`  ${chalk.dim(`line ${m.lineNumber}:`)} ${chalk.yellow(preview)}`);
    console.log(`          ${chalk.dim(m.reason)}`);
  }
}

function printFooter(): void {
  console.log('');
  console.log(divider('─', 80));
  console.log('');
}

export function printReport(filePath: string, result: AnalysisResult): void {
  printHeader(filePath, result);
  printStatusDistribution(result);
  printTimeSeries(result);
  printSlowestEndpoints(result);
  printErrorEndpoints(result);
  printTopIps(result);
  printSlowestRequests(result);
  printMalformed(result);
  printFooter();
}