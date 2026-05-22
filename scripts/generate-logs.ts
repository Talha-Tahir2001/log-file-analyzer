import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_LINES = 2000;
const OUTPUT_PATH = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : 'sample.log';
const LINES_FLAG = process.argv.indexOf('--lines');
const LINES = LINES_FLAG !== -1 ? parseInt(process.argv[LINES_FLAG + 1], 10) : DEFAULT_LINES;

const IPS = [
  '192.168.1.42', '10.0.0.7', '172.16.0.3', '10.0.0.15',
  '192.168.2.100', '203.0.113.42', '198.51.100.7', '10.10.10.10',
  '192.168.1.1', '172.31.255.254',
];

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHOD_WEIGHTS = [50, 25, 10, 8, 7];  

const PATHS = [
  '/api/users',
  '/api/users/:id',
  '/api/posts',
  '/api/posts/:id',
  '/api/comments',
  '/api/login',
  '/api/logout',
  '/api/search',
  '/api/settings',
  '/api/uploads',
  '/health',
  '/metrics',
  '/static/app.js',
  '/static/app.css',
  '/',
];

const STATUS_CODES = [200, 200, 200, 200, 201, 204, 301, 304, 400, 401, 403, 404, 422, 429, 500, 502, 503];

const USER_AGENTS = [
  '"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
  '"curl/7.68.0"',
  '"python-requests/2.28.1"',
  '"Go-http-client/1.1"',
  '"axios/1.4.0"',
];


function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick<T>(arr: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function responseTime(status: number): number {
  if (status >= 500) return randInt(200, 5000);
  if (status >= 400) return randInt(10, 300);
  if (status === 301 || status === 304) return randInt(1, 20);
  return randInt(5, 800);
}

function expandPath(p: string): string {
  return p.replace(':id', String(randInt(1, 10000)));
}

function fmtIso(d: Date): string {
  return d.toISOString().replace('.000', '');  // 2024-03-15T14:23:01Z
}

function fmtSlash(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}/${mo}/${day} ${h}:${m}:${s}`;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtMon(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[d.getUTCMonth()];
  const y = d.getUTCFullYear();
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${day}-${mon}-${y} ${h}:${m}:${s}`;
}

function fmtEpoch(d: Date): string {
  return String(Math.floor(d.getTime() / 1000));
}

function pickTimestamp(d: Date): string {
  const r = Math.random();
  if (r < 0.70) return fmtIso(d);       // 70% canonical ISO
  if (r < 0.82) return fmtSlash(d);     // 12% slash format
  if (r < 0.92) return fmtMon(d);       // 10% Mon format
  return fmtEpoch(d);                   // 8%  Unix epoch
}

function pickResponseTime(ms: number): string {
  const r = Math.random();
  if (r < 0.70) return `${ms}ms`;                              // 70% "142ms"
  if (r < 0.85) return `${(ms / 1000).toFixed(3)}s`;          // 15% "0.142s"
  return `${ms}`;                                              // 15% bare integer
}

function canonicalLine(d: Date): string {
  const ip = pick(IPS);
  const method = weightedPick(METHODS, METHOD_WEIGHTS);
  const rawPath = expandPath(pick(PATHS));
  const status = pick(STATUS_CODES);
  const rt = responseTime(status);
  const ts = pickTimestamp(d);
  const rtStr = pickResponseTime(rt);

  // Occasionally append extra fields (user agent / referrer)
  const extras = Math.random() < 0.15
    ? ` ${pick(USER_AGENTS)}`
    : '';

  // Occasionally use "-" for status (missing status)
  const statusStr = Math.random() < 0.02 ? '-' : String(status);

  return `${ts} ${ip} ${method} ${rawPath} ${statusStr} ${rtStr}${extras}`;
}

function jsonLine(d: Date): string {
  const ip = pick(IPS);
  const method = weightedPick(METHODS, METHOD_WEIGHTS);
  const rawPath = expandPath(pick(PATHS));
  const status = pick(STATUS_CODES);
  const rt = responseTime(status);

  const obj: Record<string, unknown> = {
    timestamp: fmtIso(d),
    ip,
    method,
    path: rawPath,
    status,
    responseTime: pickResponseTime(rt),
  };

  if (Math.random() < 0.3) {
    obj['url'] = obj['path'];
    delete obj['path'];
  }
  if (Math.random() < 0.2) {
    obj['duration'] = obj['responseTime'];
    delete obj['responseTime'];
  }

  return JSON.stringify(obj);
}

function partialLine(d: Date): string {
  const ts = fmtIso(d);
  const ip = pick(IPS);
  const variants = [
    `${ts} ${ip}`,                                  // truncated after IP
    `${ts}`,                                         // just timestamp
    `${ts} ${ip} GET`,                              // truncated after method
    `${ts} ${ip} GET /api/users 200`,               // missing response time
  ];
  return pick(variants);
}

function stackTraceLine(): string {
  const traces = [
    '    at Object.query (/app/db/client.js:142:15)',
    '    at async Handler.execute (/app/routes/api.js:87:5)',
    '    ... 12 more lines',
    '    at processTicksAndRejections (internal/process/task_queues.js:95:5)',
  ];
  return pick(traces);
}

function garbageLine(): string {
  const garbage = [
    '-- ROTATING LOG FILE --',
    '================================================================================',
    'null',
    '{}',
    '[]',
    'undefined',
    '\x00\x01\x02binary garbage',
    'WARN: config reload triggered',
    '2024-03-15 INVALID_METHOD /path 200 10ms',  // bad method
  ];
  return pick(garbage);
}

function generate(lineCount: number, outputPath: string): void {
  const outDir = path.dirname(outputPath);
  if (outDir && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const stream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  const now = Date.now();
  const start = now - 24 * 60 * 60 * 1000;

  let written = 0;
  let normalCount = 0;
  let malformedCount = 0;

  const flushEvery = 500;

  for (let i = 0; i < lineCount; i++) {
    const progress = i / lineCount;
    const jitter = randFloat(-0.002, 0.002);
    const ts = new Date(start + (progress + jitter) * (now - start));

    const r = Math.random();
    let line: string;

    if (r < 0.82) {
      // 82% standard canonical lines
      line = canonicalLine(ts);
      normalCount++;
    } else if (r < 0.91) {
      // 9% JSON lines
      line = jsonLine(ts);
      normalCount++;
    } else if (r < 0.94) {
      // 3% partial/truncated lines
      line = partialLine(ts);
      malformedCount++;
    } else if (r < 0.96) {
      // 2% stack trace lines (occasionally preceded by a valid line that "throws")
      line = stackTraceLine();
      malformedCount++;
    } else if (r < 0.97) {
      // 1% blank lines
      line = '';
    } else {
      // 3% other garbage
      line = garbageLine();
      malformedCount++;
    }

    if (Math.random() < 0.03 && line.trim() !== '') {
      line = '  ' + line;
    }

    stream.write(line + '\n');
    written++;    
    if (written % flushEvery === 0) {
      process.stdout.write(`\r  Generating... ${written.toLocaleString()} / ${lineCount.toLocaleString()} lines`);
    }
  }

  stream.end(() => {
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
    console.log(`  ✓ Generated ${written.toLocaleString()} lines → ${outputPath}`);
    console.log(`    ~${normalCount.toLocaleString()} valid lines, ~${malformedCount.toLocaleString()} malformed`);
  });
}

generate(LINES, OUTPUT_PATH);