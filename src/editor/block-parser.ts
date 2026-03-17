import type Token from 'markdown-it/lib/token.mjs';
import { type Block, generateBlockKey, resetBlockCounter } from './block-model';
import { getMarkdownIt } from '../renderer';

/**
 * markdown-it のトークンストリームを使用して markdown コンテンツをブロックに分割する。
 * 各ブロックはソース行の連続範囲に対応する。
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

    // ソースマップのないトークンをスキップ（inline, softbreak など）
    if (!token.map) {
      i++;
      continue;
    }

    const [start, end] = token.map;
    const block = tokenToBlock(token, tokens, lines, start, end);

    if (block) {
      blocks.push(block);
    }

    // 開始/終了ペアの終了トークンまでスキップ
    i = skipToClose(tokens, i, token) + 1;
  }

  // 後処理: HTML構造をマージ（details, div など）
  blocks = mergeHtmlStructures(blocks, lines);

  // 後処理: 未カバー行のギャップを埋める（脚注など）
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
      // インラインコンテンツを検索
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
        text: token.content.replace(/\n$/, ''), // 末尾改行を除いた内部コンテンツ
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
      // マップ付きの未知のブロックレベルトークン — 段落として扱う
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
 * 開始トークンから対応する終了トークンまでスキップする。
 * 自己完結トークン（fence, hr, html_block）の場合は同じインデックスを返す。
 */
function skipToClose(tokens: Token[], index: number, token: Token): number {
  // 自己完結トークン
  if (token.nesting !== 1) {
    return index;
  }

  // 対応する終了トークンを検索
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
 * 単一の構造を形成するHTMLブロックをマージする（例: <details>...</details>）。
 * markdown-it が複数行HTMLを個別のトークンに分割し、間にmarkdownコンテンツが挟まる場合、
 * それらを単一ブロックに再統合する。
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
          // 対応する閉じタグのない開始タグ — 閉じブロックを検索
          let j = i + 1;
          let found = false;
          while (j < blocks.length) {
            if (blocks[j].type === 'html' && blocks[j].text.includes(`</${tag}`)) {
              // 元のソース行を使用してブロック i から j をマージ
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
 * どのブロックにもカバーされていないソース行を見つけてブロックを作成する。
 * markdown-it がソースマップを割り当てずに処理する脚注定義などのコンテンツを処理する。
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
        // 空白でないコンテンツがある場合のみブロックを作成
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
