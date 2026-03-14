import type { Block } from './block-model';

/**
 * Reconstruct full Markdown source from blocks.
 * For most blocks, text already contains raw Markdown.
 * For fence blocks, we reconstruct the ``` delimiters.
 */
export function exportMarkdown(blocks: Block[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'fence': {
        const lang = block.lang || '';
        parts.push('```' + lang + '\n' + block.text + '\n```');
        break;
      }
      case 'math':
        parts.push('$$\n' + block.text + '\n$$');
        break;
      default:
        parts.push(block.text);
        break;
    }
  }

  return parts.join('\n\n');
}
