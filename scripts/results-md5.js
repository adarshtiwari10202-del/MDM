// MD5 fingerprint of the live Results sheet — a one-line integrity check used
// before and after the peer-analysis workflow so we can prove the main data
// store was not touched. Prints "RESULTS_MD5=<hex> rows=<n>".
import crypto from 'node:crypto';
import { readResults } from '../backend/store.js';

const r = await readResults();
const payload = JSON.stringify(r);
const md5 = crypto.createHash('md5').update(payload).digest('hex');
console.log(`RESULTS_MD5=${md5} rows=${r.length} bytes=${payload.length}`);
