# log-analyzer

A CLI tool that parses server log files and produces an on-call-friendly terminal report: error rates, slow endpoints, traffic patterns, top IPs, and a clear count of malformed lines.

---

## Quick start (fresh machine)

### Prerequisites

- Node.js 18+ (`node --version`)
- npm 8+

### Install and run

```bash
# 1. Clone / enter the repo
cd log-analyzer

# 2. Install dependencies
npm install

# 3. Generate a sample log file (optional but recommended)
npm run generate
# → writes sample.log in the project root

# 4. Analyze a log file
npm run analyze -- sample.log

# Or analyze any other file
npm run analyze -- /var/log/myapp/access.log
```

### Build and run compiled output

```bash
npm run build
node dist/index.js sample.log
```

---

## Log generator

The `scripts/generate-logs.ts` script creates a realistic, intentionally messy log file that covers all format variants the parser handles.

```bash
# Generate 2,000 lines (default) → sample.log
npm run generate

# Custom output path and line count
npx ts-node scripts/generate-logs.ts logs/big.log --lines 100000
```

The generated file includes:
- Four timestamp formats (ISO 8601, slash-separated, `15-Mar-2024`, Unix epoch)
- Three response-time formats (`142ms`, `0.142s`, bare integer)
- JSON-formatted log lines mixed in (~9%)
- Truncated/partial lines (~3%)
- Stack trace continuation lines (~2%)
- Blank lines (~1%)
- Miscellaneous garbage (~3%)

---

## CLI options

```
Usage: log-analyzer <logfile> [options]

Arguments:
  logfile          path to the log file to analyze

Options:
  --json           output raw JSON instead of the formatted report
  --top <n>        number of top items per section (default: 10)
  -V, --version    output version number
  -h, --help       display help
```

---

## What the report shows

| Section | What it tells you |
|---|---|
| Header | Total lines, valid vs. malformed count, time span |
| Status distribution | Breakdown of 2xx / 3xx / 4xx / 5xx with bar chart |
| Request volume over time | Traffic sparkline, auto-granularity (minute / hour / day) |
| Slowest endpoints | p95 and p99 latency per endpoint (min 5 requests) |
| Highest error rate | Endpoints with the worst 4xx/5xx rates |
| Top IPs | Busiest clients with their error rates |
| Slowest requests | 10 individual worst-latency entries |
| Malformed lines | Count by reason, first 5 samples |

---

## Project structure

```
log-analyzer/
├── src/
│   ├── index.ts       # CLI entry point (commander)
│   ├── parser.ts      # Stream-based parser, all format variants
│   ├── analyzer.ts    # Aggregation: endpoints, IPs, time series
│   ├── reporter.ts    # Terminal output (chalk + cli-table3)
│   └── types.ts       # Shared types
├── scripts/
│   └── generate-logs.ts  # Test data generator
├── package.json
├── tsconfig.json
├── README.md
└── ANSWERS.md
```

---

## Running against a large file

The parser uses Node's `readline` streaming interface, so it reads the file one line at a time without loading it into memory. A 500,000-line file uses roughly the same peak memory as a 1,000-line file.
