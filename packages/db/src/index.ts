export type DatabaseDialect = "d1" | "postgres";

export interface MigrationStatus {
  applied: readonly string[];
  pending: readonly string[];
}
