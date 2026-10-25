import type { Marked } from 'marked'
export declare function escapeHtml(s: unknown): string
export declare function isSafeLink(href: string): boolean
export declare function isSafeImage(src: string): boolean
export declare const md: Marked
export declare function renderMarkdown(src: string, opts?: { resolveImage?: (src: string) => string; externalImages?: boolean }): string
