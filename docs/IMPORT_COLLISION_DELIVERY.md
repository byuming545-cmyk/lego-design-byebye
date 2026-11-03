# Real import and collision delivery

Baseline: `a1e4210ba1389a19c8b83fccd328f8a6f2ece4de` on `codex/part-import-production`.
Work branch: `codex/import-collision-closure`. No push, main merge or deployment.

## 中文结论

已将真实新件 **3062b** 从固定来源导入、按已知接口准入、正式生成、导出重导入并事务晋升。来源件数 **253→254**，结构生成资格 **104→105**。普通 Stud 接口开放，另三个来源特征继续禁用。

生成了 **1×2431＋4×3062b** 的五件结构，并修复了几组表面接触误判。旧来源 **988 个文件全部原字节保留**。服务采用明确的重启更新流程，旧快照与未完成事务不会被当作当前目录继续使用。

物理稳定性、安装路径和实物验证仍未完成；149 种结构阻塞件未被批量放行。当前 bundle 格式仍要求存在同编号 Shadow 根文件；只有 primitive connectivity、没有该根文件的来源需要后续扩展格式，不能补造 Shadow 文件。

## Actual result

- Native identities: 253 → **254**. Colours do not multiply identities.
- Structural grammar eligibility: 104 → **105**; blocked structural identities remain **149**.
- Exterior-only eligibility: **128**, unchanged. This is surface capability, not 128 validated assemblies.
- New source identity / new eligibility / actually generated / promoted: **1 / 1 / 1 / 1**, all `3062b`.
- Native root geometry/source integrity: 254. Raw connection parsing: 206 ready / 44 partial / 4 missing.
- Raw/canonical source features: 5,085 → **5,089**. Allowed structural source endpoints: 2,545 → **2,546**.
- Production rule families remain C01, BAR_CLIP, PIN_HOLE. No new mechanical fit was invented.
- `3062b` has four source features; only `p/stud2a.dat:11:0` is enabled. Its scaled underside and unclassified round features remain disabled. No bar-receptacle permission follows from the hollow stud.

`artifacts/import-collision/3062b-promotion.json` and `data/parts-foundation/ldraw/imports/3062b.json` record the actual transaction. Source-ready and geometry-ready do not mean all interfaces or physical assembly are certified.

## Source corrections

The pinned geometry manifest already used `pybricks/ldraw`, but the importer allowed only `ldraw/ldraw`. The new whitelist uses the actual reviewed repository, an exact revision-root URL and exact agreement with both base manifests. An arbitrary GitHub URL, another repository at the same commit string, or a nested path is not accepted.

The acquisition tool uses normal HTTPS through the environment proxy, saves unchanged bytes and HTTP outcomes, and recursively resolves actual geometry and Shadow dependencies. No access control was bypassed. The 3062b closure contains ten geometry files and three Shadow files. Two geometry files and one Shadow file were new; shared files are explicitly declared as `reuse` and checked against base hashes. Root identity, description and author are checked against its source header. Every dependency retains its own source author and licence.

Original files are never overwritten. `source-preservation.json` checks all **988** prior manifested source files against the baseline hashes. New originals are:

- LDraw `parts/3062b.dat` — James Jessiman.
- LDraw `parts/s/3062bs01.dat` — Takeshi Takahashi [RainbowDolphin].
- Shadow `parts/3062b.dat` — LDCad Shadow Library.

Geometry uses the source-declared LDraw CC BY 4.0 licence; Shadow uses CC BY-SA 4.0. Existing licence/attribution texts remain in the source directories. This does not grant a new licence for the entire application. The acquisition bundle contains no PDF, private mappings, Studio installation assets or historical models.

## Why a real new part could not finish before

Three separate catalogue issues were corrected:

1. The source whitelist disagreed with the existing reviewed source.
2. The generator enumerated the global bundled catalogue even when its engine used a staging repository. It now receives the selected repository's actual identities.
3. Export validation used a process-cached global manifest, rejecting new staging identities. Internal staging exports now use their trusted repository manifest; public exports check the current source snapshot.

The report separates source import, geometry, connector interpretation, admission, collision representation, generation coverage and promotion. A bounded search failure stays NOT_FOUND/BUDGET_EXHAUSTED and does not erase successful source import or establish permanent incompatibility. Promotion still requires a normal generated model, whole graph checks, export and VALID reimport.

A public `interface-assembly` structural goal uses the existing family index, connector solver, source-allowed attitudes, physical endpoint occupancy, attachment API and final graph validation. It supports connected structures of 2–32 parts, rather than a hardcoded pair or shape. Requested identities guide ordering; they never grant permissions or determine coordinates. Existing wall/platform/chassis design restrictions remain valid for those separate goals.

## Collision finding and correction

The baseline shell/solid algorithm sometimes classified a probe outside the actual intersecting edge:

- 3024 + 11477: actual edge from `[6,0,6]` to `[6,-7,6]`; the old inside probe `[6,0.25,6]` extends past the endpoint.
- 3001 + 18973: actual edge Y range `[-8,-4]`; the old inside probe at Y `-3.75` extends outside it.
- Another 3001 + 11477 pose: reverse hit was **1.3151918984 LDU** away from the line being probed.

These are numerical algorithm findings, not guesses about physical parts. The immutable baseline comparison includes raw endpoints, hit points, both probes, classifications and source evidence.

The new shell/closed path partitions **every unchanged source triangle** using all relevant closed-face cuts and checks every resulting cell. Unknown winding or incomplete partition returns blocked. A cell inside closed material must lie entirely within the existing convex source seat; checking its centroid alone is insufficient. No seat radius, depth or collision tolerance was increased. Unresolved results do not receive/reuse a clearance certificate.

Complete surface partition does **not** mean a complete closed-solid/physical certificate: the shell retains open boundaries, no fabricated caps or thickness, and `structuralSupport:false` / `containmentChecked:false`. Non-adjacent shell/solid pairs can be checked without a seat; they receive no insertion exemption.

Two old tests labelled endpoint/grazing contacts as real penetration. Their expected outcomes were corrected only after the recorded baseline witnesses above and complete surface checks demonstrated the error. Their assertions were replaced with explicit contact/partition assertions and an additional genuine source-panel penetration negative. A panel translated into brick material and shell/shell crossings still fail; UNKNOWN and incomplete geometry remain blocked.

This does not solve all boundary branching or non-planar source shells. It fixes a common shell/solid contact decision error while preserving structural restrictions.

## Generated evidence

Each directory under `artifacts/import-collision/models/` contains JSON, LDraw, BOM, steps, sources, validation and reimported model:

| Directory | Structure | Evidence scope |
| --- | --- | --- |
| round-brick-support | 1×2431 + 4×3062b; 5 placements, 4 edges | Structural source geometry + allowed C01 + final graph |
| brick-panel-control | 3001 + 11477 | Surface contract control |
| plate-panel-contact | 3024 + 11477 | Recovered contact case, surface-only |
| brick-windscreen-contact | 3001 + 18973 | Recovered contact case, surface-only |

All four were produced by normal generation and reimported VALID. The new-part minimum two-part staging witness is separately preserved under `artifacts/part-import/3062b/generated/`. Recovered surface uses do not add new part identities or increase structural eligibility counts.

## Promotion and runtime consistency

Promotion publishes the source files/manifests, ledger, connector audit, coverage, runtime report, verification summary and active pointer as one journalled transaction. Derived publications get backups and readback checks and roll back with the source manifests. Recovery restores them too. A stale staging catalogue is rejected under the promotion lock to avoid losing a concurrent import.

`artifacts/part-import/catalogue-current.json` points to an immutable manifest-digest report directory. Model documents carry `sourceSnapshot`; imports still validate current sources, interfaces and graph, even when an uploaded checksum is recomputed. Old/missing catalogue snapshots or changed collision/engine versions require revalidation and are not automatically adopted.

The runtime deliberately uses **restart adoption**, not complex hot replacement:

1. During an active or unfinished import, affected API requests return 503.
2. After source manifests change, old repository/service snapshots refuse further use. API responses have `Cache-Control: no-store` and a snapshot header.
3. Restart the service, then refresh the browser. The new process builds all source, admission, generation and UI-facing indexes from the new catalogue.
4. If a transaction crashed, recover it under the import lock before restarting:

```sh
npm run import:part -- --recover
```

An unresolved lock owner is not automatically stolen. Recovery/write failures remain errors with journal evidence; they are not certified successful. Existing user models and manual examples are never deleted or silently re-certified.

The user file `data/interface-library/studio-examples.json` was absent from this Git checkout. It was not created, deleted or migrated. Its preservation on another machine cannot be certified by this delivery.

## Reproduction

```sh
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npm run test:preview
npm run evidence:import-collision
npm run audit:connections -- --output artifacts/import-collision/connection-parse
```

On a catalogue that already contains 3062b, importing it again is intentionally rejected. The real-source lifecycle test reconstructs a small source subset in a temporary directory and exercises staging, generation, transaction promotion, derived reports, stale snapshot rejection and disabled-interface attacks without changing the production catalogue.

Acquisition can be reproduced with:

```sh
python scripts/acquire-part.py 3062b --output /tmp/3062b-bundle
```

The normal import command for a catalogue lacking that identity is:

```sh
npm run import:part -- --bundle /tmp/3062b-bundle/bundle.json --promote --confirm 3062b
```

## Validation and limits

The new browser case exposed one additional integration defect: the HTTP route still used the old minimum of three parts even though the normal generator and UI allowed a two-part interface goal. The route was corrected and a dedicated HTTP generation/export/reimport regression was added. The original browser failure is retained; the assertion was not weakened.

See `artifacts/import-collision/validation-results.json` and saved command logs for final counts, intermediate failures and not-run checks. History from previous branches is not counted as a current test run. A real-source bounded-search regression also verifies that generator budget exhaustion is propagated as a coverage limit, not a permanent source/connector rejection.

Installation trajectory, material stress, retention, friction, physical stability and physical builds remain unverified. Wheel, axle, hinge and other production-family expansion is deferred. The 149 blocked structural identities still require source/topology/interface work; surface eligibility must not be used to silently grant load-bearing status.

## Final executed checks

- `npm test -- --maxWorkers=2`: **815/815**, **61 files**, 196.09 s, no skipped tests.
- `npm run build`: typecheck, client and server builds passed.
- `CI=1 npm run test:e2e`: **12/12**, including normal-page 3062b generation/export/reimport.
- `npm run test:preview`: **3/3** on the compiled application.
- Four generated example models and the staging witness reimported VALID.
- All **988** prior source file hashes remain unchanged; exactly **3** new raw source files.

Intermediate failures and their fixes are preserved in the validation JSON and logs. A targeted debugging command selected one test; the final full suite ran every test without skips. No timeouts or collision tolerances were relaxed.
