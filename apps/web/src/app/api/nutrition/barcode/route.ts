import { NextResponse } from "next/server";
import {
  decodeBarcodeFromImageBuffer,
  lookupBarcodeWithAutoCache,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireOwnerSession();
    const contentType = request.headers.get("content-type") ?? "";

    let barcode: string | null = null;
    let format = "EAN-13";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json(
          { error: "Изображение со штрихкодом не передано" },
          { status: 400 }
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decoded = await decodeBarcodeFromImageBuffer(bytes);
      if (!decoded?.barcode) {
        return NextResponse.json(
          {
            decoded: false,
            error:
              "Штрихкод на фото не распознан. Поднеси камеру ближе к полоскам или введи цифры вручную.",
          },
          { status: 200 }
        );
      }
      barcode = decoded.barcode;
      format = decoded.format;
    } else {
      const body = (await request.json()) as { barcode?: string };
      barcode = body.barcode?.trim() || null;
    }

    if (!barcode) {
      return NextResponse.json(
        { error: "Не указан штрихкод" },
        { status: 400 }
      );
    }

    const { item, offProduct } = await lookupBarcodeWithAutoCache(
      db,
      userId,
      barcode
    );

    return NextResponse.json({
      decoded: true,
      barcode: offProduct.barcode || barcode,
      format,
      item,
      offProduct,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Ошибка сканирования штрихкода",
      },
      { status: 500 }
    );
  }
}
