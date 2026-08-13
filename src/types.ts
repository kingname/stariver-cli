export type JsonObject = Record<string, unknown>;

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export interface BirthInput extends JsonObject {
  birthday: string;
  sex: "男" | "女";
  name?: string;
  archive_person_id?: string;
  shichen?: number;
  time?: string;
  city?: string;
  lng?: number;
  lat?: number;
}

export interface SseEvent {
  type: string;
  id: string;
  data: string;
}

export interface ReportRow extends JsonObject {
  task_id: string;
  report_type?: string;
  sub_report_type?: string;
  status?: string;
  birthday?: string;
  shichen?: string | number;
  sex?: string;
  comment?: string;
  created_at?: string;
}

export interface ArchivePerson extends JsonObject {
  person_id: string;
  name: string;
  birthday: string;
  shichen: number;
  sex: "男" | "女";
  report_count?: number;
}
