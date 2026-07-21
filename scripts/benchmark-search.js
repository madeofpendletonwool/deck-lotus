import { performance } from 'perf_hooks';
import { searchCards } from '../src/services/cardService.js';

async function run() {
  const queries = ['lightning', 'island', 'sol', 'dragon', 'guild', 'counterspell'];
  console.log('Running search benchmarks (warmup + timed runs)...');

  // Warmup
  for (const q of queries) {
    searchCards(q, 10);
  }

  const results = [];
  for (const q of queries) {
    const runs = 5;
    let total = 0;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const res = searchCards(q, 20);
      const t1 = performance.now();
      const ms = t1 - t0;
      total += ms;
    }
    const avg = total / runs;
    results.push({ query: q, avg_ms: avg });
  }

  console.log('Benchmark results:');
  for (const r of results) {
    console.log(`- ${r.query}: ${r.avg_ms.toFixed(2)} ms (avg)`);
  }
}

run().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
