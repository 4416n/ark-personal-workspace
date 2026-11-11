import type { Knowledge } from "../src/domain";
export const IMPORT_LIMITS: { files: number; fileBytes: number; totalBytes: number; characters: number };
export type ImportFile = { id: string; name: string; bytes: number; title: string; content: string; modifiedAt: string; error: string };
export type ImportPreview = ImportFile & { status: "new" | "conflict" | "duplicate" | "invalid"; message: string; matches: string[]; target: Knowledge | null };
export type ImportAction = "add" | "replace" | "copy" | "skip";
export function readKnowledgeFiles(files: Pick<File, "name" | "size" | "arrayBuffer" | "lastModified">[]): Promise<ImportFile[]>;
export function previewKnowledgeImport(files: ImportFile[], knowledge: Knowledge[], projectId?: string): ImportPreview[];
export function applyKnowledgeImport(knowledge: Knowledge[], preview: ImportPreview[], choices: Record<string, ImportAction>, options: { projectId?: string; importedAt: string; createId: () => string }): { knowledge: Knowledge[]; added: number; replaced: number; skipped: number };
