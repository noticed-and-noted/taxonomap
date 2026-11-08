/**
 * Merges the raw coverage of journeys run in shards (`E2E_COVERAGE=report`, one directory of
 * `coverage/e2e/raw` per shard) into one report, then holds it to the floors.
 * Usage: node tests/e2e/merge-coverage.ts <raw directory>...
 */
import { MCR } from 'monocart-coverage-reports';
import { assertCoverageFloors, coverageOptions } from './coverage.ts';

const inputDir = process.argv.slice(2);
if (!inputDir.length) throw new Error('Give the raw coverage directory of each shard.');

await MCR({ ...coverageOptions, inputDir, reports: ['console-summary', 'v8', 'lcovonly', 'json-summary'] }).generate();
await assertCoverageFloors();
