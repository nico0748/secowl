export type TargetKind = 'ip' | 'host' | 'url'
export interface CanonicalTarget {
  kind: TargetKind
  host: string
  ip: 4 | 6 | null
  port: number | null
  portExplicit: boolean
  /** 判定にもコマンドの引数にも入る、唯一の正規化済みの値 */
  value: string
  scheme?: 'http' | 'https'
}
export type CanonicalResult = CanonicalTarget | { error: string }
export type Verdict = 'in' | 'allow' | 'out' | 'deny' | 'invalid'
export interface ScopePattern { raw: unknown; kind?: 'any' | 'wildcard' | 'host' | 'ip' | 'cidr'; error?: string; [k: string]: unknown }
export interface ScopeProblem { key: string; raw: unknown; error: string }
export interface NormalizedScope {
  __normalized: true
  targets: ScopePattern[]
  allow: ScopePattern[]
  deny: ScopePattern[]
  ports: [number, number][]
  problems: ScopeProblem[]
}
export interface Evaluation {
  verdict: Verdict
  label: string
  blocked: boolean
  matched: string | null
  reason: string
  warning?: string
  problems?: ScopeProblem[]
}
export declare const SCOPE_KEYS: string[]
export declare const VERDICT_LABELS: Record<Verdict, string>
export declare const ALLOW_NOTE: string
export declare function canonicalTarget(raw: unknown): CanonicalResult
export declare function parsePattern(raw: unknown): ScopePattern
export declare function matchHost(canon: CanonicalResult | null | undefined, pattern: string | ScopePattern): boolean
export declare function parsePortList(input: unknown): { ranges: [number, number][]; error?: undefined } | { error: string; ranges?: undefined }
export declare function normalizeScope(data: Record<string, unknown> | NormalizedScope | null | undefined): NormalizedScope
export declare function evaluate(
  canon: CanonicalResult | null | undefined,
  scope: Record<string, unknown> | NormalizedScope | null | undefined,
  opts?: { ports?: string | number | Array<string | number> | [number, number][] },
): Evaluation
export declare function scopeWarnings(scope: Record<string, unknown> | NormalizedScope | null | undefined): { key: string; raw: unknown; message: string }[]
export declare function inPeriod(data: Record<string, unknown> | null | undefined, today: string): { ok: boolean; reason: string }
