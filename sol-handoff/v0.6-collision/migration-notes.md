# Migration and reproduction

Collision version changes from `native-closed-bvh-partition-1.0.0` to `native-closed-bvh-local-partition-1.1.0`. Source geometry, connector metadata, connection rules, Assembly and Generator request APIs remain unchanged. No wheel/axle/clip rule or Element mapping is introduced.

Old interface qualifications and imported models must be revalidated. Never edit version strings on old proofs. Run `npm run verify:interfaces` using a fresh checkpoint directory; source/test/version context makes old checkpoints ineligible. The completed migration, module smoke and parts report must ship together.

The original 537-case Astra pack remains immutable V0.6 comparison evidence. Its strict `astra:case` replay correctly rejects the changed collision version. Use `npm run collision:review -- MULTI-3020-3710` for an explicit old/new experiment, or `npm run collision:review` to classify all 537 cases and re-run in-scope collision diagnostics. Original manifest/case hashes and unchanged native part fingerprints are checked. Mapping and mechanical case categories are listed as outside scope, not declared fixed. Single-case runs do not overwrite full-pack reports.

The baseline migration snapshot is `baseline-migration.json.gz`. `interface-diff.json` records every old PASS that changed, independently of aggregate gains. Scheduling-budget or timeout outcomes do not establish a physical collision. Recheck such old PASS endpoints individually with the same source fixtures before deciding whether a semantic regression exists.

Rollback requires restoring both the old algorithm and its matching migration/report files from commit `2e60a8d`; restarting the server then reloads a consistent version. Do not mix an old algorithm with new qualifications.
