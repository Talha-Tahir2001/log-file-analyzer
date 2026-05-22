import * as fs from "fs";
import * as readline from "readline";

import { LogEntry, MalformedEntry, ParseResult } from "./types";

// ---------------------------------------------------------------------------
// Timestamp parsing — handles four distinct formats encountered in the wild
// ---------------------------------------------------------------------------

// Format 1 (canonical): 2024-03-15T14:23:01Z or 2024-03-15T14:23:01+00:00

const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// Format 2: 2024/03/15 14:23:01
const RE_SLASH = /^(\d{4})\/(\d{2})\/(\d{2})\s(\d{2}:\d{2}:\d{2})/;

// Format 3: 15-Mar-2024 14:23:01
// const RE_DASH = /^(\d{2})-(\w{3})-(\d{4})\s(\d{2}:\d{2}:\d{2})/;

// Format 3: 15-Mar-2024 14:23:01
const RE_MON =
  /^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})\s(\d{2}:\d{2}:\d{2})/i;

const MONTH_MAP: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

// Format 4: Unix epoch (10-digit integer)
const RE_EPOCH = /^(\d{10})(\.\d+)?\s/;

function parseTimestamp(raw: string): { date: Date; rest: string } | null {
  const epochMatch = raw.match(RE_EPOCH);
  if (epochMatch) {
    const ms = parseFloat(epochMatch[1] + (epochMatch[2] ?? "")) * 1000;
    return {
      date: new Date(ms),
      rest: raw.slice(epochMatch[0].length - 1).trimStart(),
    };
  }
  // ISO 8601
  if (RE_ISO.test(raw)) {
    const spaceIdx = raw.indexOf(" ");
    if (spaceIdx === -1) return null;
    const ts = raw.slice(0, spaceIdx);
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return { date: d, rest: raw.slice(spaceIdx + 1) };
  }

  // 2024/03/15 14:23:01
  const slashMatch = raw.match(RE_SLASH);
  if (slashMatch) {
    const iso = `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}T${slashMatch[4]}Z`;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return { date: d, rest: raw.slice(slashMatch[0].length) };
  }

  // 15-Mar-2024 14:23:01
  const monMatch = raw.match(RE_MON);
  if (monMatch) {
    const day = monMatch[1].padStart(2, "0");
    const mon = MONTH_MAP[monMatch[2].toLowerCase()];
    const iso = `${monMatch[3]}-${mon}-${day}T${monMatch[4]}Z`;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return { date: d, rest: raw.slice(monMatch[0].length) };
  }

  return null;
}

function parseResponseTime(token: string): number | null {
  if (!token) return null;
  // "142ms" or "142MS"
  const msMatch = token.match(/^(\d+(?:\.\d+)?)ms$/i);
  if (msMatch) return parseFloat(msMatch[1]);
  // "0.142s" or "1.2s"
  const sMatch = token.match(/^(\d+(?:\.\d+)?)s$/i);
  if (sMatch) return Math.round(parseFloat(sMatch[1]) * 1000);

  // bare integer or float (assume ms)
  const bareMatch = token.match(/^(\d+(?:\.\d+)?)$/);
  if (bareMatch) return parseFloat(bareMatch[1]);

  return null;
}

function parseStatusCode(token: string): number | null {
  if (!token || token === "-") return null;
  const code = parseInt(token, 10);
  // Only consider valid HTTP status codes (100–599)
  return code >= 100 && code <= 599 ? code : null;
}

function parsePath(raw: string): { path: string; query: string } {
  // Split on the first '?', if present (Query String splitting)
  const idx = raw.indexOf("?");
  if (idx === -1) return { path: raw, query: "" };
  return { path: raw.slice(0, idx), query: raw.slice(idx + 1) };
}

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
]);

function parseCanonicalRest(rest: string, lineNumber: number, timestamp: Date, raw: string): LogEntry | null {  
  const tokens = rest.trim().split(/\s+/);
  if (tokens.length < 5) return null;
 
  const [ip, method, rawPath, statusToken, rtToken] = tokens;
 
  if (!HTTP_METHODS.has(method.toUpperCase())) return null;
 
  const status = parseStatusCode(statusToken);
  const responseTimeMs = parseResponseTime(rtToken);
  const { path, query } = parsePath(rawPath);
 
  return {
    timestamp,
    ip,
    method: method.toUpperCase(),
    path,
    query,
    statusCode: status,
    responseTimeMs,
    raw,
    lineNumber,
  };
}

function parseJsonLine(line: string, lineNumber: number): LogEntry | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
 
  if (typeof obj !== 'object' || obj === null) return null;
 
  // Timestamp — accept multiple field names
  const tsRaw = obj['timestamp'] ?? obj['time'] ?? obj['ts'] ?? obj['@timestamp'];
  let timestamp: Date | null = null;
  if (typeof tsRaw === 'string') {
    const parsed = parseTimestamp(tsRaw + ' ');  // add trailing space for epoch regex
    timestamp = parsed?.date ?? new Date(tsRaw);
    if (isNaN(timestamp.getTime())) timestamp = null;
  } else if (typeof tsRaw === 'number') {
    timestamp = new Date(tsRaw > 1e10 ? tsRaw : tsRaw * 1000);
  }
  if (!timestamp) return null;
 
  const method = String(obj['method'] ?? '').toUpperCase();
  if (method && !HTTP_METHODS.has(method)) return null;
 
  const rawPath = String(obj['path'] ?? obj['url'] ?? obj['uri'] ?? '');
  if (!rawPath) return null;
 
  const { path, query } = parsePath(rawPath);
 
  const statusRaw = obj['status'] ?? obj['statusCode'] ?? obj['status_code'];
  const statusCode = statusRaw != null ? parseStatusCode(String(statusRaw)) : null;
 
  const rtRaw = obj['responseTime'] ?? obj['response_time'] ?? obj['duration'] ?? obj['latency'];
  const responseTimeMs = rtRaw != null ? parseResponseTime(String(rtRaw)) : null;
 
  const ip = String(obj['ip'] ?? obj['remoteAddr'] ?? obj['remote_addr'] ?? obj['client'] ?? '');
 
  return {
    timestamp,
    ip: ip || '0.0.0.0',
    method: method || 'UNKNOWN',
    path,
    query,
    statusCode,
    responseTimeMs,
    raw: line,
    lineNumber,
  };
}

export async function parseLogFile(filePath: string): Promise<ParseResult> {
  const entries: LogEntry[] = [];
  const malformed: MalformedEntry[] = [];
  let totalLines = 0;
  let blankLines = 0;
 
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
 
  for await (const line of rl) {
    totalLines++;
 
    const trimmed = line.trim();
 
    // Blank lines — count them but don't flag as malformed
    if (trimmed === '') {
      blankLines++;
      continue;
    }
 
    if (/^\s+at\s/.test(line) || /^\s+\.\.\.\s*\d+\s+more/.test(line)) {
      malformed.push({ raw: line, lineNumber: totalLines, reason: 'stack trace continuation' });
      continue;
    }
     
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const entry = parseJsonLine(trimmed, totalLines);
      if (entry) {
        entries.push(entry);
      } else {
        malformed.push({ raw: line, lineNumber: totalLines, reason: 'invalid JSON structure' });
      }
      continue;
    }
 
    // Timestamp-first formats
    const tsResult = parseTimestamp(trimmed);
    if (!tsResult) {
      malformed.push({ raw: line, lineNumber: totalLines, reason: 'unrecognised timestamp' });
      continue;
    }
 
    const entry = parseCanonicalRest(tsResult.rest, totalLines, tsResult.date, line);
    if (!entry) {
      malformed.push({ raw: line, lineNumber: totalLines, reason: 'incomplete fields after timestamp' });
      continue;
    }
 
    entries.push(entry);
  }
 
  return { entries, malformed, totalLines, blankLines };
}