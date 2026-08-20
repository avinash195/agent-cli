export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryFrontmatter {
  name: string;
  description: string;
  type: MemoryType;
}

export interface MemoryFile {
  path: string;
  frontmatter: MemoryFrontmatter;
  content: string;
}

export interface MemoryIndexEntry {
  name: string;
  file: string;
  description: string;
}

export interface MemoryIndex {
  entries: MemoryIndexEntry[];
  raw: string;
}
