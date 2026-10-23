import { workerData } from 'node:worker_threads';
import sharp from 'sharp';
import encode from './encode.ts';

// Each worker encodes one photo at a time; parallelism comes from the pool.
// By default libvips gets one thread per worker so workers do not compete.
sharp.concurrency(Number(workerData?.threads) || 1);
sharp.cache(false);

export default encode;
