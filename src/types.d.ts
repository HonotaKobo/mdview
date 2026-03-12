declare module 'markdown-it-task-lists' {
  import MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginWithOptions<{ enabled?: boolean }>;
  export default plugin;
}

declare module 'markdown-it-footnote' {
  import MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}

declare module 'markdown-it-texmath' {
  import MarkdownIt from 'markdown-it';
  interface TexmathOptions {
    engine?: unknown;
    delimiters?: string;
    katexOptions?: Record<string, unknown>;
  }
  const plugin: MarkdownIt.PluginWithOptions<TexmathOptions>;
  export default plugin;
}
