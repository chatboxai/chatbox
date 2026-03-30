# Performance Checklist

Use this before merging substantial ingestion/retrieval/generation changes.

## Latency
- [ ] Query p95 latency measured and within budget
- [ ] Timeouts configured and realistic
- [ ] Slow-path instrumentation added where needed

## Throughput
- [ ] External calls are async where possible
- [ ] Batching used for embedding/index writes
- [ ] Connection pooling configured for API/DB clients

## Retrieval Efficiency
- [ ] Candidate set sizes bounded
- [ ] Reranking window constrained
- [ ] Metadata indexes configured for common filters

## Memory and I/O
- [ ] Large files processed as streams/chunks when possible
- [ ] No unbounded in-memory growth in pipelines
- [ ] Intermediate artifacts cleaned up

## Regression Guardrails
- [ ] Benchmark or smoke perf test updated
- [ ] Baseline and post-change metrics logged

