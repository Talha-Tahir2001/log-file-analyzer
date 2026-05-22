export interface LogEntry {
  timestamp: Date;
  ip: string;
  method: string;
  path: string;         // normalized, no query string
  query: string;        // query string portion, may be empty
  statusCode: number | null;
  responseTimeMs: number | null;
  raw: string;
  lineNumber: number;
}

export interface MalformedEntry {
  raw: string;
  lineNumber: number;
  reason: string;
}

export interface ParseResult {
  entries: LogEntry[];
  malformed: MalformedEntry[];
  totalLines: number;
  blankLines: number;
}

export interface EndpointStats {
  path: string;
  method: string;
  count: number;
  errorCount: number;     // 4xx + 5xx
  errorRate: number;      // 0–1
  avgResponseMs: number | null;
  p95ResponseMs: number | null;
  p99ResponseMs: number | null;
  minResponseMs: number | null;
  maxResponseMs: number | null;
}

export interface StatusBucket {
  code: number | null;
  label: string;
  count: number;
}

export interface IpStats {
  ip: string;
  count: number;
  errorCount: number;
  uniquePaths: number;
}

export interface TimeSeriesBucket {
  bucket: string;      // ISO string, truncated to the bucket granularity
  count: number;
  errorCount: number;
}

export interface AnalysisResult {
  parseResult: ParseResult;
  endpointStats: EndpointStats[];
  statusDistribution: StatusBucket[];
  topIps: IpStats[];
  timeSeries: TimeSeriesBucket[];
  slowestRequests: LogEntry[];
  timeSpanMs: number | null;
  granularity: 'minute' | 'hour' | 'day';
}