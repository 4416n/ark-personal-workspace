export type Passage = {
  noteId?: string;
  title: string;
  projectId?: string;
  content: string;
  start: number;
  end: number;
  score: number;
  citation: string;
};
export function retrieve(
  knowledge: {
    id?: string;
    title: string;
    content: string;
    projectId?: string;
  }[],
  query: string,
  projectId?: string,
  limit?: number,
): Passage[];
export function retrievalContext(passages: Passage[]): string;
