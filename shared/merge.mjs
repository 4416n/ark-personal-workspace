const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function mergeWorkspace(base, local, remote) {
  const conflicts = [];
  const collections = new Set([
    "members",
    "projects",
    "tasks",
    "knowledge",
    "templates",
    "departments",
    "messages",
    "activity",
  ]);
  const merge = (a, b, c, path) => {
    if (equal(b, a)) return c;
    if (equal(c, a) || equal(b, c)) return b;
    if (
      b &&
      c &&
      a &&
      typeof b === "object" &&
      !Array.isArray(b) &&
      !Array.isArray(c)
    ) {
      return Object.fromEntries(
        [...new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)])]
          .map((k) => [k, merge(a[k], b[k], c[k], `${path}.${k}`)])
          .filter(([, v]) => v !== undefined),
      );
    }
    conflicts.push(path);
    return b;
  };
  const state = {};
  for (const key of new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ])) {
    if (collections.has(key)) {
      const a = base[key] || [],
        b = local[key] || [],
        c = remote[key] || [];
      const id = (x) => (key === "departments" ? x.name : x.id);
      const am = new Map(a.map((x) => [id(x), x])),
        bm = new Map(b.map((x) => [id(x), x])),
        cm = new Map(c.map((x) => [id(x), x]));
      const keys = [...new Set([...b.map(id), ...c.map(id)])];
      let rows = keys
        .map((k) => merge(am.get(k), bm.get(k), cm.get(k), `${key}.${k}`))
        .filter(Boolean);
      if (key === "activity")
        rows = rows.sort((x, y) => y.at.localeCompare(x.at)).slice(0, 100);
      if (key === "messages")
        rows = rows
          .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
          .slice(-200);
      if (
        base[key] !== undefined ||
        local[key] !== undefined ||
        remote[key] !== undefined
      )
        state[key] = rows;
    } else state[key] = merge(base[key], local[key], remote[key], key);
  }
  return { state, conflicts };
}
