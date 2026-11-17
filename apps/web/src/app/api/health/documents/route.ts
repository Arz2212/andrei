import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { uploadAndRegisterMedicalDocument } from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireOwnerSession();
    const formData = await request.formData();

    const recordIdRaw = formData.get("recordId");
    const file = formData.get("file");

    const recordId = Number(recordIdRaw);
    if (!Number.isFinite(recordId) || recordId <= 0) {
      return NextResponse.json(
        { error: "Не указана медицинская запись" },
        { status: 400 }
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Файл для загрузки не выбран" },
        { status: 400 }
      );
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "Размер файла должен быть не более 25 МБ" },
        { status: 400 }
      );
    }

    const mimeType = file.type || "application/pdf";
    const isPdfByExt = file.name.toLowerCase().endsWith(".pdf");
    if (!ALLOWED_MIME_TYPES.has(mimeType) && !isPdfByExt) {
      return NextResponse.json(
        { error: "Поддерживаются файлы PDF, JPG, PNG, WEBP или HEIC" },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const document = await uploadAndRegisterMedicalDocument(db, {
      userId,
      recordId,
      fileName: file.name,
      mimeType: isPdfByExt && mimeType === "application/octet-stream" ? "application/pdf" : mimeType,
      fileBody: bytes,
      sizeBytes: file.size,
    });

    revalidatePath("/", "layout");
    return NextResponse.json({ document });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Не удалось загрузить медицинский документ",
      },
      { status: 500 }
    );
  }
}
