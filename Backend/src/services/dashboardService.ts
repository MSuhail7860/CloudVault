import { prisma } from "../config/database.js";

const RECENT_FILES_LIMIT = 5;

export const getDashboardStats = async (ownerId: string) => {
  const activeFilesWhere = {
    ownerId,
    deletedAt: null,
  };

  const trashedFilesWhere = {
    ownerId,
    deletedAt: { not: null },
  };

  const [
    totalFiles,
    activeStorage,
    trashedFiles,
    trashedStorage,
    fileTypes,
    recentFiles,
  ] = await Promise.all([
    prisma.file.count({
      where: activeFilesWhere,
    }),

    prisma.file.aggregate({
      where: activeFilesWhere,
      _sum: { size: true },
    }),

    prisma.file.count({
      where: trashedFilesWhere,
    }),

    prisma.file.aggregate({
      where: trashedFilesWhere,
      _sum: { size: true },
    }),

    prisma.file.groupBy({
      by: ["mimeType"],
      where: activeFilesWhere,
      _count: { _all: true },
    }),

    prisma.file.findMany({
      where: activeFilesWhere,
      orderBy: { updatedAt: "desc" },
      take: RECENT_FILES_LIMIT,
      select: {
        id: true,
        name: true,
        originalName: true,
        mimeType: true,
        size: true,
        folderId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    files: {
      total: totalFiles,
      storageBytes: (activeStorage._sum.size ?? 0n).toString(),
    },

    trash: {
      total: trashedFiles,
      storageBytes: (trashedStorage._sum.size ?? 0n).toString(),
    },

    fileTypes: fileTypes
      .map((item) => ({
        mimeType: item.mimeType,
        count: item._count._all,
      }))
      .sort((a, b) => b.count - a.count),

    recentFiles: recentFiles.map((file) => ({
      ...file,
      size: file.size.toString(),
    })),
  };
};
