export const numeric = (v) => typeof v === "number" && Number.isFinite(v);
export function quantile(values, p) {
  const sorted = values.filter(numeric).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p, lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}
export const mean = (values) => { const v = values.filter(numeric); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const levelBand = (r) => r.highestLevel === null ? "Unavailable" : r.highestLevel === 0 ? "Ground" : r.highestLevel <= 2 ? "Levels 1–2" : r.highestLevel <= 4 ? "Levels 3–4" : "Levels 5–6";
export function dateOffset(date, days) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

export function analyzePutaway(records, from, to, facility = "All facilities") {
  const calibration = from < "2026-09-01";
  const baselineEnd = calibration ? "2026-09-01" : from;
  const baselineStart = ["2026-08-01", dateOffset(baselineEnd, -90)].sort().at(-1);
  const baseline = records.filter((r) => r.eligible && numeric(r.hours) && r.date >= baselineStart && r.date < baselineEnd);
  const byFacility = new Map();
  baseline.forEach((r) => { if (!byFacility.has(r.facility)) byFacility.set(r.facility, []); byFacility.get(r.facility).push(r); });
  const facilityMatch = (r) => facility === "All facilities" || r.facility === facility;
  const selected = records.filter((r) => r.date >= from && r.date <= to && facilityMatch(r));
  const enriched = selected.map((r) => {
    const all = byFacility.get(r.facility) || [];
    const p33 = quantile(all.map((v) => v.boxes), 1 / 3), p66 = quantile(all.map((v) => v.boxes), 2 / 3);
    const boxBand = (v) => !numeric(v.boxes) || p33 === null ? "Unavailable" : v.boxes <= p33 ? "Lower volume" : v.boxes <= p66 ? "Medium volume" : "Higher volume";
    const band = boxBand(r);
    const peers = all.filter((v) => v.recordKey !== r.recordKey && v.abc === r.abc && r.abc !== "Unclassified" && levelBand(v) === levelBand(r) && boxBand(v) === band && band !== "Unavailable");
    const candidates = peers.length >= 10 ? peers : all.filter((v) => v.recordKey !== r.recordKey);
    const reference = candidates.length >= 3 ? candidates : [];
    const median = quantile(reference.map((v) => v.hours), 0.5), p75 = quantile(reference.map((v) => v.hours), 0.75);
    const contexts = [];
    if (r.highestLevel >= 5) contexts.push("Upper-level storage");
    if (r.reachShare > 0) contexts.push(`${Math.round(r.reachShare * 100)}% of R-bin units require reach truck`);
    if (band === "Higher volume") contexts.push("Higher box volume");
    if (r.shelfCount > 1) contexts.push(`${r.shelfCount} destination shelves`);
    const reason = !r.eligible ? "Insufficient eligible shelf/completion data" : r.hours <= 7 ? "Within 7-hour target" : p75 === null ? "Above target; insufficient benchmark history" : r.hours > p75 ? "Above historical P75; investigate queue or handling delays" : "Above target; within historical P75";
    return { ...r, volumeBand: band, median, p75, peerCount: reference.length,
      benchmarkScope: peers.length >= 10 ? "Facility + ABC + level + box band" : "Facility only",
      variance: r.eligible && median !== null ? r.hours - median : null, contexts, reason };
  });
  const eligible = enriched.filter((r) => r.eligible && numeric(r.hours));
  const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
  const previousFrom = dateOffset(from, -days);
  const previous = records.filter((r) => r.eligible && numeric(r.hours) && r.date >= previousFrom && r.date < from && facilityMatch(r));
  return { rows: enriched, eligible, average: mean(eligible.map((r) => r.hours)), previousAverage: mean(previous.map((r) => r.hours)),
    previousCount: previous.length, previousFrom, baselineStart, baselineEnd: dateOffset(baselineEnd, -1), calibration,
    aboveTarget: eligible.filter((r) => r.hours > 7).length,
    aboveP75: eligible.filter((r) => r.p75 !== null && r.hours > r.p75).length };
}

export function groupPutaway(rows, key) {
  const groups = new Map();
  rows.forEach((r) => { const name = key(r); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(r); });
  return Array.from(groups, ([name, values]) => ({ name, count: values.length, hours: mean(values.map((r) => r.hours)),
    median: quantile(values.map((r) => r.hours), 0.5), p75: quantile(values.map((r) => r.hours), 0.75),
    above: values.filter((r) => r.hours > 7).length, boxes: values.every((r) => numeric(r.boxes)) ? values.reduce((n, r) => n + r.boxes, 0) : null }));
}
