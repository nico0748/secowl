export interface MetricDef { id: string; label: string; options: [string, string][] }
export declare const V31_METRICS: MetricDef[]
export declare const V31_TEMPORAL: MetricDef[]
export declare const V31_ENVIRONMENTAL: MetricDef[]
export declare const V40_BASE: MetricDef[]
export declare function parseVector(vector: string): Record<string, string>
export declare function buildVector31(m: Record<string, string>): string
export declare function buildVector40(m: Record<string, string>): string
export declare function score31(m: Record<string, string>): { base: number; temporal: number; environmental: number } | null
export declare function severityFromScore(score: number | string): string | null
