import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import chalk from 'chalk';
import { parseLogFile } from './parser';
import { analyze } from './analyzer';
import { printReport } from './reporter';

const program = new Command();

program
    .name('log-file-analyzer')
    .description('Analyze server log files — summaries, slow endpoints, error rates, and more')
    .version('1.0.0')
    .argument('<logfile>', 'path to the log file to analyze')
    .option('--json', 'output raw JSON instead of the formatted report')
    .option('--top <n>', 'number of top items to show in each section', '10')
    .action(async (logfile: string, options: { json?: boolean; top?: string }) => {
        const resolved = path.resolve(logfile);
        if (!fs.existsSync(resolved)) {
            console.error(chalk.red(`Error: file not found: ${resolved}`));
            process.exit(1);
        }

        const stat = fs.statSync(resolved);
        if (!stat.isFile()) {
            console.error(chalk.red(`Error: not a regular file: ${resolved}`));
            process.exit(1);
        }

        if (stat.size === 0) {
            console.error(chalk.yellow(`Warning: file is empty: ${resolved}`));
            process.exit(0);
        }
        try {
            if (!options.json) {
                process.stdout.write(chalk.dim('  Parsing...'));
            }

            const parseResult = await parseLogFile(resolved);

            if (!options.json) {
                process.stdout.write(chalk.dim(' Analyzing...'));
            }

            const result = analyze(parseResult);

            if (!options.json) {
                process.stdout.write('\r' + ' '.repeat(30) + '\r');  // clear spinner line
                printReport(resolved, result);
            } else {
                // JSON output — strip non-serialisable Date objects
                const out = {
                    ...result,
                    parseResult: {
                        ...result.parseResult,
                        entries: result.parseResult.entries.map(e => ({
                            ...e,
                            timestamp: e.timestamp.toISOString(),
                        })),
                    },
                    slowestRequests: result.slowestRequests.map(e => ({
                        ...e,
                        timestamp: e.timestamp.toISOString(),
                    })),
                };
                console.log(JSON.stringify(out, null, 2));
            }
        } catch (err) {
            console.error(chalk.red(`\nFailed to analyze log file: ${(err as Error).message}`));
            if (process.env['DEBUG']) console.error(err);
            process.exit(1);
        }
    });

program.parse();