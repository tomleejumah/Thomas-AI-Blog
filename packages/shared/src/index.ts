export type ContentStatus =
  | "IDEA"
  | "RESEARCH"
  | "DRAFT"
  | "AI_GENERATED"
  | "HUMAN_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "UPDATED";

export type JobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export type ContentLanguage = "en" | "pt" | "fr";

export interface SiteConnectionInput {
  name: string;
  baseUrl: string;
  wpUsername: string;
  wpAppPassword: string;
}
