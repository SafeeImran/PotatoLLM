import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./client";
import type { Attachment } from "./types";

export async function pickAttachment(): Promise<Attachment | null> {
  const path = await open({
    multiple: false,
    directory: false,
  });
  if (typeof path !== "string") return null;
  return api.post<Attachment>("/attachments", { source_path: path });
}

export function listAttachments(): Promise<Attachment[]> {
  return api.get<Attachment[]>("/attachments");
}

export function deleteAttachment(id: string): Promise<void> {
  return api.del(`/attachments/${id}`);
}
