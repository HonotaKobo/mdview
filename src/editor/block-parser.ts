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
  let blocks: Block[] = [];
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

  // Post-process: merge HTML structures (details, div, etc.)
  blocks = mergeHtmlStructures(blocks, lines);

  // Post-process: fill gaps for uncovered lines (footnotes, etc.)
  blocks = fillUncoveredLines(blocks, lines);

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

    case 'math_block':
      return {
        key: generateBlockKey(),
        type: 'math',
        text: token.content.replace(/\n$/, ''),
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

/**
 * Merge HTML blocks that form a single structure (e.g., <details>...</details>).
 * When markdown-it splits multi-line HTML into separate tokens with interleaved
 * markdown content, merge them back into a single block.
 */
function mergeHtmlStructures(blocks: Block[], lines: string[]): Block[] {
  const mergeableTags = ['details', 'div', 'section', 'article', 'aside', 'nav', 'figure'];
  const result: Block[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === 'html') {
      const match = block.text.match(/^<(\w+)[\s>]/);
      if (match) {
        const tag = match[1].toLowerCase();
        if (mergeableTags.includes(tag) && !block.text.includes(`</${tag}`)) {
          // Opening tag without matching close — find the closing block
          let j = i + 1;
          let found = false;
          while (j < blocks.length) {
            if (blocks[j].type === 'html' && blocks[j].text.includes(`</${tag}`)) {
              // Merge blocks i through j using original source lines
              const mergedText = lines.slice(block.sourceStart, blocks[j].sourceEnd).join('\n');
              result.push({
                key: block.key,
                type: 'html',
                text: mergedText,
                sourceStart: block.sourceStart,
                sourceEnd: blocks[j].sourceEnd,
              });
              i = j + 1;
              found = true;
              break;
            }
            j++;
          }
          if (found) continue;
        }
      }
    }
    result.push(block);
    i++;
  }
  return result;
}

/**
 * Find source lines not covered by any block and create blocks for them.
 * This handles footnote definitions and other content that markdown-it
 * processes without assigning source maps.
 */
function fillUncoveredLines(blocks: Block[], lines: string[]): Block[] {
  blocks.sort((a, b) => a.sourceStart - b.sourceStart);

  const totalLines = lines.length;
  const covered = new Set<number>();
  for (const block of blocks) {
    for (let line = block.sourceStart; line < block.sourceEnd; line++) {
      covered.add(line);
    }
  }

  let uncoveredStart = -1;
  for (let line = 0; line <= totalLines; line++) {
    const isUncovered = line < totalLines && !covered.has(line);
    if (isUncovered) {
      if (uncoveredStart === -1) uncoveredStart = line;
    } else {
      if (uncoveredStart !== -1) {
        const text = lines.slice(uncoveredStart, line).join('\n');
        // Only create block if there's non-blank content
        if (text.trim()) {
          blocks.push({
            key: generateBlockKey(),
            type: 'paragraph',
            text,
            sourceStart: uncoveredStart,
            sourceEnd: line,
          });
        }
        uncoveredStart = -1;
      }
    }
  }

  blocks.sort((a, b) => a.sourceStart - b.sourceStart);
  return blocks;
}
