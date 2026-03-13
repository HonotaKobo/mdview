export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'fence'
  | 'code'
  | 'bullet_list'
  | 'ordered_list'
  | 'blockquote'
  | 'table'
  | 'hr'
  | 'html'
  | 'front_matter'
  | 'math'
  | 'deflist';

export interface Block {
  key: string;
  type: BlockType;
  text: string;         // raw markdown source (content only, no fences for code)
  level?: number;       // heading level 1-6
  lang?: string;        // code block language
  sourceStart: number;  // start line in original source (0-indexed)
  sourceEnd: number;    // end line (exclusive)
}

let blockCounter = 0;

export function generateBlockKey(): string {
  return `b${++blockCounter}`;
}

export function resetBlockCounter(): void {
  blockCounter = 0;
}
