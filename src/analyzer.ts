import {
    LogEntry,
    ParseResult,
    EndpointStats,
    StatusBucket,
    IpStats,
    TimeSeriesBucket,
    AnalysisResult,
} from './types';

function percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

export function computeEndpointStats(entries: LogEntry[]): EndpointStats[] {
    const map = new Map<string, {
        count: number;
        errorCount: number;
        responseTimes: number[];
    }>();

    for (const e of entries) {
        const key = `${e.method} ${e.path}`;
        let bucket = map.get(key);
        if (!bucket) {
            bucket = { count: 0, errorCount: 0, responseTimes: [] };
            map.set(key, bucket);
        }

        bucket.count++;

        if (e.statusCode !== null && e.statusCode >= 400) {
            bucket.errorCount++;
        }

        if (e.responseTimeMs !== null) {
            bucket.responseTimes.push(e.responseTimeMs);
        }
    }

    const stats: EndpointStats[] = [];

    for (const [key, b] of map.entries()) {
        const spaceIdx = key.indexOf(' ');
        const method = key.slice(0, spaceIdx);
        const path = key.slice(spaceIdx + 1);

        const times = b.responseTimes;
        const avg = times.length > 0
            ? times.reduce((a, v) => a + v, 0) / times.length
            : null;

        stats.push({
            path,
            method,
            count: b.count,
            errorCount: b.errorCount,
            errorRate: b.count > 0 ? b.errorCount / b.count : 0,
            avgResponseMs: avg !== null ? Math.round(avg) : null,
            p95ResponseMs: percentile(times, 95),
            p99ResponseMs: percentile(times, 99),
            minResponseMs: times.length > 0 ? Math.min(...times) : null,
            maxResponseMs: times.length > 0 ? Math.max(...times) : null,
        });
    }

    return stats;
}

function statusLabel(code: number | null): string {
    if (code === null) return 'Unknown';
    if (code >= 500) return '5xx Server Error';
    if (code >= 400) return '4xx Client Error';
    if (code >= 300) return '3xx Redirect';
    if (code >= 200) return '2xx Success';
    if (code >= 100) return '1xx Informational';
    return 'Other';
}

export function computeStatusDistribution(entries: LogEntry[]): StatusBucket[] {
    const map = new Map<string, { code: number | null; count: number }>();

    for (const e of entries) {
        const label = statusLabel(e.statusCode);
        const bucket = map.get(label);
        if (!bucket) {
            map.set(label, { code: e.statusCode, count: 1 });
        } else {
            bucket.count++;
        }
    }

    return Array.from(map.entries())
        .map(([label, { code, count }]) => ({ code, label, count }))
        .sort((a, b) => b.count - a.count);
}

export function computeTopIps(entries: LogEntry[], limit = 10): IpStats[] {
    const map = new Map<string, { count: number; errorCount: number; paths: Set<string> }>();

    for (const e of entries) {
        let bucket = map.get(e.ip);
        if (!bucket) {
            bucket = { count: 0, errorCount: 0, paths: new Set() };
            map.set(e.ip, bucket);
        }
        bucket.count++;
        if (e.statusCode !== null && e.statusCode >= 400) bucket.errorCount++;
        bucket.paths.add(e.path);
    }

    return Array.from(map.entries())
        .map(([ip, b]) => ({
            ip,
            count: b.count,
            errorCount: b.errorCount,
            uniquePaths: b.paths.size,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}


function truncateToGranularity(date: Date, granularity: 'minute' | 'hour' | 'day'): string {
    const d = new Date(date);
    if (granularity === 'minute') {
        d.setSeconds(0, 0);
    } else if (granularity === 'hour') {
        d.setMinutes(0, 0, 0);
    } else {
        d.setHours(0, 0, 0, 0);
    }
    return d.toISOString();
}

export function computeTimeSeries(
    entries: LogEntry[]
): { buckets: TimeSeriesBucket[]; granularity: 'minute' | 'hour' | 'day' } {
    if (entries.length === 0) return { buckets: [], granularity: 'minute' };

    const times = entries.map(e => e.timestamp.getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const spanMs = maxTime - minTime;

    let granularity: 'minute' | 'hour' | 'day';
    if (spanMs <= 2 * 60 * 60 * 1000) {
        granularity = 'minute';
    } else if (spanMs <= 7 * 24 * 60 * 60 * 1000) {
        granularity = 'hour';
    } else {
        granularity = 'day';
    }

    const map = new Map<string, { count: number; errorCount: number }>();

    for (const e of entries) {
        const bucket = truncateToGranularity(e.timestamp, granularity);
        let b = map.get(bucket);
        if (!b) {
            b = { count: 0, errorCount: 0 };
            map.set(bucket, b);
        }
        b.count++;
        if (e.statusCode !== null && e.statusCode >= 400) b.errorCount++;
    }

    const buckets: TimeSeriesBucket[] = Array.from(map.entries())
        .map(([bucket, b]) => ({ bucket, count: b.count, errorCount: b.errorCount }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket));

    return { buckets, granularity };
}


export function computeSlowestRequests(entries: LogEntry[], limit = 10): LogEntry[] {
    return entries
        .filter(e => e.responseTimeMs !== null)
        .sort((a, b) => (b.responseTimeMs ?? 0) - (a.responseTimeMs ?? 0))
        .slice(0, limit);
}


export function analyze(parseResult: ParseResult): AnalysisResult {
    const { entries } = parseResult;

    const endpointStats = computeEndpointStats(entries);
    const statusDistribution = computeStatusDistribution(entries);
    const topIps = computeTopIps(entries);
    const { buckets: timeSeries, granularity } = computeTimeSeries(entries);
    const slowestRequests = computeSlowestRequests(entries);

    const times = entries.map(e => e.timestamp.getTime());
    const timeSpanMs = times.length > 1
        ? Math.max(...times) - Math.min(...times)
        : null;

    return {
        parseResult,
        endpointStats,
        statusDistribution,
        topIps,
        timeSeries,
        slowestRequests,
        timeSpanMs,
        granularity,
    };
}