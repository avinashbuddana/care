# Measured import benchmark

Measured 30 October 2026 with the real import engine (`runImport`): streaming parse, COPY into batch staging, full-file validation, catalog verification, and transactional upsert publication. It is not an extrapolated row loop.

| Synthetic rows | Elapsed (engine) | Sampled peak RSS | Result                        |
| -------------- | ---------------- | ---------------- | ----------------------------- |
| 100,000        | 1,681 ms         | 166 MiB          | completed; 100,000 inserted   |
| 1,000,000      | 16,191 ms        | 236 MiB          | completed; 1,000,000 inserted |

| Environment        |                                                                           |
| ------------------ | ------------------------------------------------------------------------- |
| Dataset shape      | bigint unique key, text, numeric(12,2); no references; empty target table |
| Host               | Apple M4, 16 GiB RAM, Darwin arm64 (developer laptop)                     |
| Runtime / database | Node 24.22.1; PostgreSQL 16.13 (Homebrew, local socket over 127.0.0.1)    |
| Competing load     | none                                                                      |

Memory grew from 166 MiB to 236 MiB for 10× the rows, which is consistent with streaming and backpressure. The file is never held in memory.

Limitations:

- RSS is sampled every 10 ms and can miss short spikes.
- Excludes fixture generation and setup.
- One 1M-row publication is a single transaction. It holds a SHARE ROW EXCLUSIVE lock on the target and generates WAL for every row, so concurrent writers to that table wait for its duration.
- References, wide rows, many indexes, network storage, replication and contention will change the results materially.
- Production Compose targets Node 22. These are not throughput guarantees.

Before raising `UPLOAD_MAX_BYTES` or worker concurrency, benchmark your real schemas and file sizes, and measure lock wait on the target tables during publication.

Reproduce against an isolated, migrated database:

```sh
TEST_DATABASE_URL=postgres://... pnpm --filter @platform/ingestion benchmark 1000000
```

The script creates and removes its own synthetic fixtures. Never benchmark against operational data.
