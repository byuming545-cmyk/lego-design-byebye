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
  let images;
  try {
    images = await wiki("commons.wikimedia.org", {
      action: "query",
      generator: "search",
      gsrsearch: query + (input.variant ? " " + input.variant : ""),
      gsrnamespace: "6",
      gsrlimit: "12",
      prop: "imageinfo",
      iiprop: "url|extmetadata|mime",
      iiurlwidth: "1024",
    });
  } catch (e) {
    result.issues.push("IMAGE_SEARCH_FAILED: " + String(e));
    return result;
  }
  await writeFile(
    path.join(directory, "image-search.json"),
    JSON.stringify(images.data, null, 2),
  );
  const seen = new Set<string>();
  for (const record of images.data.query?.pages ?? []) {
    if (result.images.length >= 6) break;
    const title = String(record.title);
    if (!titleVariantMatch(title, input.variant)) continue;
    if (
      ![String(input.year), ...input.model.toLowerCase().split(/\s+/)].every(
        (t) => title.toLowerCase().includes(t.toLowerCase()),
      ) ||
      /restomod|custom|replica|modified/i.test(title)
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
      const { bytes, mime } = await boundedFetch(url);
      if (!/^image\/(jpeg|png|webp)/.test(mime)) throw Error("IMAGE_MIME");
      const sha256 = hash(bytes);
      if (seen.has(sha256)) continue;
      seen.add(sha256);
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
        mime,
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
