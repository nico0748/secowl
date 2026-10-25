export type LeakKind = 'cookie' | 'authorization' | 'jwt' | 'email' | 'secret'
export interface Leak { kind: LeakKind; count: number; sample: string }
export declare function fence(text: string, lang?: string): string
export declare function isMasked(value: string): boolean
export declare function findLeaks(text: string): Leak[]
export declare function redactHttp(
  text: string,
  opts?: { cookie?: boolean; authorization?: boolean; jwt?: boolean; secret?: boolean; email?: boolean; terms?: string[] },
): { text: string; hits: { kind: string; count: number }[] }
