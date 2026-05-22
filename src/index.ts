import { Command } from "commander";
import * as path from "path";


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
    })