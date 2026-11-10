// Normal history is bounded; safeguards are additive, never eviction candidates.
export const MAX_BUILD_PINS = 20;
export const isBuildRunning = (build) =>
  ["generating", "validating", "cancelling"].includes(build.status);
export function protectedBuilds(newestFirst) {
  const protectedIds = new Set();
  const stableProjects = new Set();
  for (const build of newestFirst) {
    if (build.pinned || isBuildRunning(build)) protectedIds.add(build.id);
    if (
      (build.status === "verified" ||
        (build.status === "restored" && build.restoredStatus === "verified")) &&
      build.files?.length &&
      !stableProjects.has(build.projectId)
    ) {
      stableProjects.add(build.projectId);
      protectedIds.add(build.id);
    }
  }
  return protectedIds;
}
export function retainedBuildIds(newestFirst) {
  const keep = protectedBuilds(newestFirst);
  const perProject = new Map();
  let ordinary = 0;
  for (const build of newestFirst) {
    const count = perProject.get(build.projectId) || 0;
    perProject.set(build.projectId, count + 1);
    if (count < 5 && ordinary < 30) {
      keep.add(build.id);
      ordinary++;
    }
  }
  return keep;
}
