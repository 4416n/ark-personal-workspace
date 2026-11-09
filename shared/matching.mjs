// The UI and the server share the same explainable assignment rules.
export function rankMembers(skills, members, tasks = [], additionalHours = 0) {
  const required = [
    ...new Set(skills.map((s) => s.trim().toLowerCase()).filter(Boolean)),
  ];
  return members
    .map((member) => {
      const matched = required.flatMap((skill) => {
        const found = member.skills.find(
          (s) =>
            s.toLowerCase().includes(skill) || skill.includes(s.toLowerCase()),
        );
        return found
          ? [{ skill: found, level: member.skillLevels?.[found] ?? 3 }]
          : [];
      });
      const hours = tasks
        .filter((t) => t.ownerId === member.id && t.status !== "done")
        .reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
      const load = hours / member.capacity;
      const afterLoad = (hours + additionalHours) / member.capacity;
      const skillScore = required.length
        ? matched.reduce((sum, m) => sum + m.level / 5, 0) / required.length
        : 0;
      const available = member.availability !== "paused";
      const score = available
        ? Math.round(
            Math.max(
              0,
              Math.min(100, skillScore * 75 + Math.max(0, 1 - afterLoad) * 25),
            ),
          )
        : 0;
      const reason = !available
        ? "已暂停接单"
        : `${matched.length ? `匹配 ${matched.map((m) => `${m.skill} ${m.level}/5`).join("、")}` : "暂无直接匹配技能"}；当前 ${hours}/${member.capacity}h${additionalHours ? `，分配后 ${Math.round(afterLoad * 100)}%` : ""}${afterLoad > 1 ? "，超出计划容量" : ""}`;
      return {
        member,
        matched,
        hours,
        load,
        afterLoad,
        score,
        available,
        reason,
      };
    })
    .sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        b.score - a.score ||
        a.load - b.load,
    );
}
export function recommendedMember(skills, members, tasks = [], hours = 0) {
  const top = rankMembers(skills, members, tasks, hours).find(
    (r) => r.available,
  );
  return top
    ? { ownerId: top.member.id, reason: top.reason }
    : { ownerId: "", reason: "暂无可接单员工，请手动安排" };
}
