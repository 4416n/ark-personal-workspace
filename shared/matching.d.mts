export type MatchMember = {
  id: string;
  name: string;
  skills: string[];
  capacity: number;
  skillLevels?: Record<string, number>;
  availability?: "available" | "paused";
};
export type MatchTask = {
  ownerId: string;
  status: string;
  estimatedHours: number;
};
export type Ranking<M> = {
  member: M;
  matched: { skill: string; level: number }[];
  hours: number;
  load: number;
  afterLoad: number;
  score: number;
  available: boolean;
  reason: string;
};
export function rankMembers<M extends MatchMember>(
  skills: string[],
  members: M[],
  tasks?: MatchTask[],
  additionalHours?: number,
): Ranking<M>[];
export function recommendedMember(
  skills: string[],
  members: MatchMember[],
  tasks?: MatchTask[],
  hours?: number,
): { ownerId: string; reason: string };
