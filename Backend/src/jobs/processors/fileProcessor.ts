import { prisma } from "../../config/database.js";
import { downloadObject } from "../../services/storageService.js";
import { withActiveAccountLock } from "../../services/accountLifecycleService.js";

export interface FileProcessingData {
  fileId: string;
}

export const processFileJob = async (
  data: FileProcessingData,
): Promise<void> => {
  const { fileId } = data;

  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      storageKey: true,
      ownerId: true,
      deletedAt: true,
      metadata: true,
    },
  });

  if (!file || file.deletedAt) {
    return;
  }

  try {
    const processingUpdate = await withActiveAccountLock(
      file.ownerId,
      (tx) => tx.file.updateMany({
        where: { id: file.id },
        data: { processingStatus: "PROCESSING" },
      }),
    );

    if (processingUpdate.count !== 1) return;

    const metadata: Record<string, unknown> = {
      ...(file.metadata && typeof file.metadata === "object"
        ? file.metadata as Record<string, unknown>
        : {}),
      processedAt: new Date().toISOString(),
      sizeBytes: file.size.toString(),
      mimeType: file.mimeType,
    };

    if (
      file.mimeType.startsWith("text/") ||
      file.mimeType === "application/json" ||
      file.mimeType === "application/javascript"
    ) {
      const obj = await downloadObject(file.storageKey);

      if (!obj.Body) {
        throw new Error("File content could not be downloaded from storage.");
      }

      const bytes = await obj.Body.transformToByteArray();
      const text = Buffer.from(bytes).toString("utf-8");

      metadata.lineCount = text.split(/\r\n|\r|\n/).length;
      metadata.characterCount = text.length;
      metadata.hasPreview = true;
    } else if (file.mimeType.startsWith("image/")) {
      metadata.category = "image";
      metadata.isImage = true;
      metadata.hasPreview = true;
    } else if (file.mimeType === "application/pdf") {
      metadata.category = "document";
      metadata.isPdf = true;
      metadata.hasPreview = true;
    } else {
      metadata.category = "binary";
      metadata.hasPreview = false;
    }

    await withActiveAccountLock(file.ownerId, (tx) =>
      tx.file.updateMany({
        where: { id: file.id },
        data: {
          processingStatus: "COMPLETED",
          metadata: metadata as any,
        },
      }),
    );

    console.log(
      `[FileProcessor] Successfully processed file: ${file.name} (${file.id})`,
    );
  } catch (error) {
    console.error(`[FileProcessor] Error processing file ${file.id}:`, error);

    const errorMessage =
      error instanceof Error ? error.message : "Processing failed";

    try {
      const currentFile = await prisma.file.findUnique({
        where: { id: file.id },
        select: { metadata: true },
      });

      const existingMetadata =
        currentFile?.metadata && typeof currentFile.metadata === "object"
          ? currentFile.metadata as Record<string, unknown>
          : {};

      await withActiveAccountLock(file.ownerId, (tx) =>
        tx.file.updateMany({
          where: { id: file.id },
          data: {
            processingStatus: "FAILED",
            metadata: {
              ...existingMetadata,
              error: errorMessage,
              failedAt: new Date().toISOString(),
            } as any,
          },
        }),
      );
    } catch (statusError) {
      console.error(
        `[FileProcessor] Could not update failure status for ${file.id}:`,
        statusError,
      );
    }

    throw error;
  }
};
