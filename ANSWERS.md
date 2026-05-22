# ANSWERS.md

---

## 1. How to run

**Prerequisites:** Node.js 18+, npm 8+

```bash
# Install dependencies
npm install

# Generate a sample log file
npm run generate

# Run the analyzer
npm run analyze -- sample.log
```

To run against your own file:

```bash
npm run analyze -- /path/to/your/logfile.log
```

To get raw JSON output (useful for piping or post-processing):

```bash
npm run analyze -- sample.log --json
```

No global installs required. Everything runs locally via `ts-node`.

---

## 2. Stack choice

**I chose TypeScript + Node.js.**

The task is fundamentally: read a text file line by line, parse strings, aggregate data, and print a report. Node's `readline` module handles streaming text files natively and efficiently — the parser never loads the whole file into memory, which matters when log files can be hundreds of thousands of lines.

TypeScript adds the type safety that makes refactoring the parser safe (the `LogEntry` type enforces that every code path either produces a valid entry or explicitly marks it malformed). `chalk` and `cli-table3` are battle-tested CLI presentation libraries.

**A worse choice would be Python** for this specific submission — not because Python is bad at parsing (it isn't), but because the setup story on a fresh machine is heavier and more fragile: Python version conflicts, venv activation, `pip install` vs. `pip3`, and a non-obvious entry point. A TypeScript CLI is `npm install && npm run analyze -- file.log` from any Node 18 machine.

**C# / .NET would also be worse here.** LINQ is excellent for the aggregation layer, but .NET startup time for a small CLI is perceptible (100–500ms JIT warmup), `dotnet restore` adds friction, and the resulting binary is heavier to distribute. .NET shines for long-running services; it's overkill for a parse-and-report CLI.

---

## 3. One real edge case

**Leading whitespace on otherwise valid log lines.**

**File:** `src/parser.ts`  
**Relevant line:** The `trimmed` variable derived from `line.trim()` on the raw input line, used throughout the parse cascade.

Some logging systems (syslog, Docker log drivers, certain log shippers) indent continuation lines or add padding. The spec's sample data even shows one line with leading spaces:

```
  2024-03-15T14:23:04Z 192.168.1.42 GET /api/users/12 200 53ms
```

Without the `trim()` call, the timestamp regex would fail to match because the string starts with `  2024-...` rather than `2024-...`. That line would fall through to the malformed bucket with reason `"unrecognised timestamp"` — a silently dropped valid entry.

With the trim, the line parses correctly. The `raw` field on `LogEntry` still stores the original (un-trimmed) line so nothing is lost.

The generator also randomly prepends two spaces to ~3% of lines (`scripts/generate-logs.ts`, the section near the bottom of the loop) specifically to exercise this path.

---

## 4. AI usage

**Tool used:** Claude (claude.ai)

### What I asked / what it gave

1. **Initial scaffolding prompt:** "Scaffold a TypeScript CLI log analyzer with a cascading parser, analytics layer, and rich terminal reporter." Claude produced the initial file structure, `types.ts`, and a first-pass `parser.ts` with the four timestamp regex patterns.

2. **Generator prompt:** "Write a log generator that produces ~5–10% malformed lines including partial writes, stack traces, JSON lines, and format variants." Claude produced `generate-logs.ts` with weighted random selection.

### What I changed and why

The initial `parser.ts` Claude produced used a single large regex to match entire log lines:

```ts
// Claude's original approach
const LINE_RE = /^(\S+)\s+(\S+)\s+(GET|POST|...) ...$/;
```

I replaced this with the staged cascade (parse timestamp first → extract rest → parse remaining tokens). The single-regex approach breaks on the "extras" fields (user agents with spaces, quoted referrers) because you can't know where the fixed fields end and optional trailing content begins. The staged approach doesn't care how many extra tokens follow — it just reads the five it needs and ignores the rest. This is the difference between parsing correctly and being fragile against the spec's "extra fields appended on some lines" requirement.

I also rewrote the response-time parser from a `switch` on a matched group to the three-branch function in `parser.ts` (`parseResponseTime`), because Claude's version didn't handle the case where the unit suffix could be uppercase (`142MS`, `0.5S`) and didn't handle the "bare integer assumed as ms" case.

---

## 5. Honest gap

**The time-series section degrades on sparse files with long time spans.**

If a log file covers 30 days but has only 200 entries, the auto-granularity picks `day`, and you get a meaningful chart. But if it covers 30 days with 200,000 entries *unevenly distributed* — say, 99% of traffic in one hour — the daily buckets hide all the interesting variance. The current granularity logic (`src/analyzer.ts`, `computeTimeSeries`) only looks at total span, not at the distribution of entries within that span.

**What I'd do with another day:** Compute the interquartile range of inter-request timestamps and use that to pick granularity dynamically. If the median gap between requests is 50ms, minute-level granularity is right even if the file covers multiple days. I'd also add a `--since` and `--until` flag so operators can zoom in on a time window without preprocessing the file.
