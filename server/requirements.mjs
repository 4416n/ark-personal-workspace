import { createHash } from "node:crypto";
export const REQUIREMENTS_VERSION = 2;
export const hashInput = (input) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
// Keep the complete input for prompts and compatibility with pre-v2 fingerprints.
export function requirements(state, id) {
  return {
    project: state?.projects.find((p) => p.id === id),
    tasks:
      state?.tasks
        .filter((t) => t.projectId === id)
        .map((t) => ({
          id: t.id,
          executionMode: t.executionMode,
          title: t.title,
          description: t.description,
          deliverable: t.deliverable,
          acceptanceCriteria: t.acceptanceCriteria,
          dependsOn: t.dependsOn,
          result: t.result,
        })) || [],
    knowledge:
      state?.knowledge.filter((n) => !n.projectId || n.projectId === id) || [],
  };
}
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function semanticRequirements(input) {
  const p = input.project;
  return {
    project: p
      ? {
          id: p.id,
          title: p.title,
          goal: p.goal,
          successCriteria: p.successCriteria || "",
          deliveryType: p.deliveryType || "document",
        }
      : null,
    tasks: input.tasks
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description || "",
        result: t.result || "",
        executionMode: t.executionMode || "ai",
        deliverable: t.deliverable || "",
        acceptanceCriteria: t.acceptanceCriteria || [],
        dependsOn: [...(t.dependsOn || [])].sort(),
      }))
      .sort(byId),
    // Include all scoped facts, not only today's retrieval hits. Exclude derived
    // mirrors: their actual text is already in tasks; timestamps are not facts.
    knowledge: input.knowledge
      .filter((n) => !n.sourceTaskId)
      .map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        projectId: n.projectId || "",
      }))
      .sort(byId),
  };
}
export const requirementsHash = (input, version = REQUIREMENTS_VERSION) =>
  hashInput(version === 1 ? input : semanticRequirements(input));
