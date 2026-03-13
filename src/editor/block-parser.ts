import type Token from 'markdown-it/lib/token.mjs';
import { type Block, generateBlockKey, resetBlockCounter } from './block-model';
import { getMarkdownIt } from '../renderer';

/**
 * Parse markdown content into blocks using markdown-it's token stream.
 * Each block maps to a contiguous range of source lines.
 */
export function parseBlocks(content: string): Block[] {
  resetBlockCounter();
  const md = getMarkdownIt();
  const tokens = md.parse(content, {});
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // Skip tokens without source map (inline, softbreak, etc.)
    if (!token.map) {
      i++;
      continue;
    }

    const [start, end] = token.map;
    const block = tokenToBlock(token, tokens, lines, start, end);

    if (block) {
      blocks.push(block);
    }

    // Skip past the closing token for open/close pairs
    i = skipToClose(tokens, i, token) + 1;
  }

  return blocks;
}

function tokenToBlock(
  token: Token,
  _tokens: Token[],
  lines: string[],
  start: number,
  end: number,
): Block | null {
  const rawLines = lines.slice(start, end);
  const text = rawLines.join('\n');

  switch (token.type) {
    case 'heading_open': {
      const level = parseInt(token.tag.slice(1), 10);
      // Find the inline content
      return {
        key: generateBlockKey(),
        type: 'heading',
        text,
        level,
        sourceStart: start,
        sourceEnd: end,
      };
    }

    case 'paragraph_open':
      return {
        key: generateBlockKey(),
        type: 'paragraph',
        text,
        sourceStart: start,
        sourceEnd: end,
      };

    case 'fence':
      return {
        key: generateBlockKey(),
        type: 'fence',
        text: token.content.replace(/\n$/, ''), // inner content without trailing newline
        lang: token.info.trim() || undefined,
        sourceStart: start,
        sourceEnd: end,
      };

    case 'code_block':
      return {
        key: generateBlockKey(),
        type: 'code',
        text: token.content.replace(/\n$/, ''),
        sourceStart: start,
        sourceEnd: end,
      };

    case 'bullet_list_open':
      return {
        key: generateBlockKey(),
        type: 'bullet_list',
        text,
        sourceStart: start,
        sourceEnd: end,
      };

    case 'ordered_list_open':
      return {
        key: generateBlockKey(),
        type: 'ordered_list',
        text,
        sourceStart: start,
        sourceEnd: end,
      };

    case 'blockquote_open':
      return {
        key: generateBlockKey(),
        type: 'blockquote',
        text,
        sourceStart: start,
        sourceEnd: end,
      };

    case 'table_open':
      return {
        key: generateBlockKey(),
        type: 'table',
        text,
        sourceStart: start,
        sourceEnd: end,
      };

    case 'hr':
      return {
        key: generateBlockKey(),
        type: 'hr',
        text,
        sourceStart: start,
        sourceEnd: end,
      };

    case 'html_block':
      return {
        key: generateBlockKey(),
        type: 'html',
        text: token.content.replace(/\n$/, ''),
        sourceStart: start,
        sourceEnd: end,
      };

    case 'front_matter':
      return {
        key: generateBlockKey(),
        type: 'front_matter',
        text,
        sourceStart: start,
        sourceEnd: end,
      };

    case 'dl_open':
      return {
        key: generateBlockKey(),
        type: 'deflist',
        text,
        sourceStart: start,
        sourceEnd: end,
      };

    default:
      // Unknown block-level token with map — treat as paragraph
      if (token.map) {
        return {
          key: generateBlockKey(),
          type: 'paragraph',
          text,
          sourceStart: start,
          sourceEnd: end,
        };
      }
      return null;
  }
}

/**
 * Skip from an opening token to its matching close token.
 * For self-closing tokens (fence, hr, html_block), returns the same index.
 */
function skipToClose(tokens: Token[], index: number, token: Token): number {
  // Self-closing tokens
  if (token.nesting !== 1) {
    return index;
  }

  // Find matching close token
  const closeType = token.type.replace('_open', '_close');
  let depth = 1;
  for (let j = index + 1; j < tokens.length; j++) {
    if (tokens[j].type === token.type) depth++;
    if (tokens[j].type === closeType) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return index;
}
