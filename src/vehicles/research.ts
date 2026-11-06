import { VISION_PROMPT } from "./vision-contract.js";
import { imageFeedback, successfulResearch } from "./image-feedback.js";
import sharp from "sharp";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { boundedFetch, hash, wiki } from "./network.js";
import type { Measurement, Research, VehicleInput } from "./types.js";
export function titleVariantMatch(title: string, variant: string) {
  const wanted = variant.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!wanted) return true;
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((_, i) =>
    [1, 2, 3, 4].some((n) => words.slice(i, i + n).join("") === wanted),
  );
}
const clean = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function parseMeasurements(
  document: string,
  sourceId: string,
  year: number,
): Measurement[] {
  const out: Measurement[] = [];
  const starts = [...document.matchAll(/\{\{infobox automobile\b/gi)];
  for (const start of starts) {
    let depth = 0,
      end = start.index!;
    for (; end < document.length - 1; end++) {
      const pair = document.slice(end, end + 2);
      if (pair === "{{") {
        depth++;
        end++;
      } else if (pair === "}}") {
        depth--;
        end++;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
    if (depth !== 0) continue;
    out.push(...parseBox(document.slice(start.index, end), sourceId, year));
  }
  return out;
}
function parseBox(text: string, sourceId: string, year: number): Measurement[] {
  // Only explicitly scoped infobox fields: retain ambiguous or conflicting values, never fill gaps.
  const years = [
    ...text.matchAll(/(?:production|model[ _]years)\s*=([^\n]+)/gi),
  ].flatMap((m) =>
    [...m[1].matchAll(/(?:18|19|20)\d{2}/g)].map((x) => Number(x[0])),
  );
  if (!years.length || year < Math.min(...years) || year > Math.max(...years))
    return [];
  const out: Measurement[] = [];
  for (const key of ["length", "width", "height", "wheelbase"] as const) {
    for (const match of text.matchAll(
      new RegExp("\\|\\s*" + key + "\\s*=([^\n]+)", "gi"),
    )) {
      const line = match[1];
      const found = [
        ...line.matchAll(/\{\{convert\|([\d,.]+)\|(mm|cm|m|in)\b/gi),
      ];
      for (const [index, m] of found.entries()) {
        const segment = line.slice(
          m.index!,
          found[index + 1]?.index ?? line.length,
        );
        const scopes = [
          ...segment.matchAll(
            /\((?:MY)?((?:19|20)\d{2})(?:[–-]((?:19|20)?\d{2}))?[^)]*\)/gi,
          ),
        ];
        if (
          scopes.length &&
          !scopes.some((x) => {
            const lo = Number(x[1]),
              hi = x[2]
                ? Number(x[2].length === 2 ? x[1].slice(0, 2) + x[2] : x[2])
                : lo;
            return year >= lo && year <= hi;
          })
        )
          continue;
        const n =
          Number(m[1].replace(/,/g, "")) *
          { mm: 1, cm: 10, m: 1000, in: 25.4 }[m[2].toLowerCase()]!;
        if (n > 0 && n < 20000)
          out.push({
            key,
            mm: Math.round(n * 10) / 10,
            sourceId,
            scope: "generation-body",
            applicableYears: years,
            variant: "unconfirmed",
            evidence: line.trim(),
          });
      }
    }
  }
  return out;
}
export async function researchVehicle(
  input: VehicleInput,
  directory: string,
): Promise<Research> {
  const previous = await successfulResearch(input, hash(VISION_PROMPT));
  if (previous) {
    await mkdir(directory, { recursive: true });
    for (const image of previous.research.images) {
      const data = await readFile(
        path.join(previous.imagesDirectory, image.localFile),
      );
      if (hash(data) !== image.sha256) throw Error("RESEARCH_CACHE_INTEGRITY");
      await writeFile(path.join(directory, image.localFile), data);
      if (image.originalFile) {
        const original = await readFile(
          path.join(previous.imagesDirectory, image.originalFile),
        );
        if (hash(original) !== image.originalSha256)
          throw Error("RESEARCH_CACHE_ORIGINAL_INTEGRITY");
        await writeFile(path.join(directory, image.originalFile), original);
      }
    }
    for (const source of previous.research.sources) {
      const raw = await readFile(
        path.join(previous.imagesDirectory, source.id + ".wiki.json"),
      );
      if (hash(raw) !== source.sha256)
        throw Error("RESEARCH_CACHE_SOURCE_INTEGRITY");
      await writeFile(path.join(directory, source.id + ".wiki.json"), raw);
    }
    return structuredClone(previous.research);
  }
  const result: Research = {
    input,
    sources: [],
    measurements: [],
    images: [],
    issues: [],
  };
  await mkdir(directory, { recursive: true });
  const query = `${input.year} ${input.make} ${input.model}`;
  const search = await wiki("en.wikipedia.org", {
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "5",
  });
  const wanted = (input.make + " " + input.model)
    .toLowerCase()
    .split(/\s+/)
    .filter((x) => x.length > 1);
  const candidates = (search.data.query?.search ?? []).filter(
    (x: any) =>
      wanted.every((t) => x.title.toLowerCase().includes(t)) &&
      x.title.replace(/\s*\([^)]*\)$/, "").toLowerCase() ===
        (input.make + " " + input.model).toLowerCase(),
  );
  for (const candidate of candidates.slice(0, 3)) {
    const page = await wiki("en.wikipedia.org", {
      action: "query",
      prop: "revisions",
      rvprop: "content|ids",
      rvslots: "main",
      pageids: String(candidate.pageid),
    });
    const record = page.data.query.pages[0],
      rev = record.revisions?.[0];
    const text = rev?.slots?.main?.content ?? "";
    const sourceId = hash(page.bytes),
      measurements = parseMeasurements(text, sourceId, input.year);
    if (!measurements.length) continue;
    await writeFile(path.join(directory, sourceId + ".wiki.json"), page.bytes);
    result.sources.push({
      id: sourceId,
      url: `https://en.wikipedia.org/w/index.php?oldid=${rev.revid}`,
      retrievedAt: page.retrievedAt,
      sha256: sourceId,
      scope: "Generation/body dimensions; exact trim unconfirmed",
      text,
    });
    result.measurements.push(...measurements);
  }
  if (!result.measurements.length)
    result.issues.push("DIMENSIONS_MISSING_OR_YEAR_SCOPE_UNCONFIRMED");
  for (const key of ["length", "width", "height", "wheelbase"]) {
    const values = new Set(
      result.measurements.filter((x) => x.key === key).map((x) => x.mm),
    );
    if (values.size > 1) result.issues.push("CONFLICT_" + key);
    if (!values.size) result.issues.push("MISSING_" + key);
  }
  const groups: any[][] = [];
  try {
    const c = await wiki("commons.wikimedia.org", {
      action: "query",
      generator: "categorymembers",
      gcmtitle: `Category:${input.year} ${input.make} ${input.model}`,
      gcmtype: "file",
      gcmlimit: "50",
      prop: "imageinfo",
      iiprop: "url|extmetadata|mime|size",
      iiurlwidth: "1024",
    });
    await writeFile(
      path.join(directory, "image-category.json"),
      JSON.stringify(c.data, null, 2),
    );
    groups.push(
      (c.data.query?.pages ?? []).map((x: any) => ({
        ...x,
        categoryEvidence: true,
      })),
    );
  } catch (e) {
    result.issues.push("IMAGE_CATEGORY_FAILED: " + String(e));
  }

  const searches = [
    query + (input.variant ? " " + input.variant : ""),
    query + " side",
    query + " rear",
    query + " front",
  ];
  for (const [index, search] of searches.entries()) {
    try {
      const response = await wiki("commons.wikimedia.org", {
        action: "query",
        generator: "search",
        gsrsearch: search,
        gsrnamespace: "6",
        gsrlimit: "12",
        prop: "imageinfo",
        iiprop: "url|extmetadata|mime|size",
        iiurlwidth: "1024",
      });
      await writeFile(
        path.join(directory, "image-search-" + index + ".json"),
        JSON.stringify(response.data, null, 2),
      );
      groups.push(response.data.query?.pages ?? []);
    } catch (e) {
      result.issues.push("IMAGE_SEARCH_FAILED: " + String(e));
      if (/HTTP_403|HTTP_429|BACKOFF/.test(String(e))) break;
    }
  }
  const records: any[] = [];
  for (let i = 0; i < 50; i++)
    for (const group of groups) if (group[i]) records.push(group[i]);
  const excluded = await imageFeedback(input);
  const seen = new Set<string>();
  const visualHashes: bigint[] = [];
  const authors = new Map<string, number>();
  result.imageAudit = [];
  for (const record of records) {
    if (result.images.length >= 8) break;
    const title = String(record.title);

    if (
      (!record.categoryEvidence &&
        ![String(input.year), ...input.model.toLowerCase().split(/\s+/)].every(
          (t) => title.toLowerCase().includes(t.toLowerCase()),
        )) ||
      /restomod|custom|replica|modified|diecast|miniature|scale model|interior|dashboard|engine|hellephant|hellcat/i.test(
        title,
      )
    )
      continue;
    const info = record.imageinfo?.[0],
      meta = info?.extmetadata;
    if (!info || !meta || !/^image\/(jpeg|png|webp)$/.test(info.mime)) continue;
    const license = clean(meta.LicenseShortName?.value ?? ""),
      licenseUrl = clean(meta.LicenseUrl?.value ?? ""),
      author = clean(meta.Artist?.value ?? "");
    if (!author || !licenseUrl || !/^(CC BY|CC0|Public domain)/i.test(license))
      continue;
    try {
      const candidateUrl = String(info.thumburl ?? info.url);
      const url = candidateUrl.replace(
        /^http:\/\/(upload\.wikimedia\.org)\//,
        "https://$1/",
      );
      const raw = await boundedFetch(url);
      const originalBytes = raw.bytes,
        mime = raw.mime;
      if (excluded.has(hash(originalBytes))) {
        result.imageAudit!.push({
          title,
          reason: "prior-provider-negative-selection",
        });
        continue;
      }
      const bytes = await sharp(originalBytes, { limitInputPixels: 16000000 })
        .rotate()
        .resize({
          width: 1024,
          height: 1024,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      const pixels = await sharp(bytes)
        .resize(9, 8, { fit: "fill" })
        .greyscale()
        .raw()
        .toBuffer();
      let dhash = 0n;
      for (let yy = 0; yy < 8; yy++)
        for (let xx = 0; xx < 8; xx++)
          dhash =
            (dhash << 1n) |
            (pixels[yy * 9 + xx] > pixels[yy * 9 + xx + 1] ? 1n : 0n);
      const distance = (a: bigint, b: bigint) => {
        let n = a ^ b,
          c = 0;
        while (n) {
          c++;
          n &= n - 1n;
        }
        return c;
      };
      if (
        visualHashes.some((h) => distance(h, dhash) <= 8) ||
        (authors.get(author) ?? 0) >= 2
      ) {
        result.imageAudit!.push({
          title,
          reason: visualHashes.some((h) => distance(h, dhash) <= 8)
            ? "near-duplicate-dhash"
            : "author-diversity-quota",
        });
        continue;
      }
      if (!/^image\/(jpeg|png|webp)/.test(mime)) throw Error("IMAGE_MIME");
      const sha256 = hash(bytes);
      if (seen.has(sha256)) continue;
      seen.add(sha256);
      visualHashes.push(dhash);
      authors.set(author, (authors.get(author) ?? 0) + 1);
      const originalSha256 = hash(originalBytes);
      await writeFile(
        path.join(directory, originalSha256 + ".original.image"),
        originalBytes,
      );
      const localFile = sha256 + ".image";
      await writeFile(path.join(directory, localFile), bytes, {
        flag: "wx",
      }).catch(async (e) => {
        if (e.code !== "EEXIST") throw e;
        if (hash(await readFile(path.join(directory, localFile))) !== sha256)
          throw Error("CACHE_INTEGRITY");
      });
      result.images.push({
        id: sha256,
        title,
        page: info.descriptionurl,
        url,
        sha256,
        mime: "image/jpeg",
        originalSha256,
        originalFile: originalSha256 + ".original.image",
        perceptualHash: dhash.toString(16),
        author,
        license,
        licenseUrl,
        localFile,
        identity: "title-candidate",
        view: "unknown",
      });
    } catch (e) {
      result.issues.push(
        e instanceof Error ? e.message : "IMAGE_DOWNLOAD_FAILED",
      );
      if (/HTTP_403|HTTP_429/.test(String(e))) break;
    }
  }
  if (result.images.length < 3)
    result.issues.push("INSUFFICIENT_IMAGE_CANDIDATES");
  return result;
}
