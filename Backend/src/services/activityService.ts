import { prisma } from "../config/database.js";

export type ActivityAction =
  | "FILE_UPLOADED"
  | "FILE_DOWNLOADED"
  | "FILE_RENAMED"
  | "FILE_MOVED"
  | "FILE_DELETED"
  | "FILE_RESTORED"
  | "FILE_PERMANENTLY_DELETED"
  | "FOLDER_CREATED"
  | "FOLDER_RENAMED"
  | "FOLDER_MOVED"
  | "FOLDER_DELETED"
  | "FILE_SHARED"
  | "SHARE_PERMISSION_UPDATED"
  | "SHARE_REVOKED"
  | "FILE_VERSION_CREATED";

export interface LogActivityInput {
  userId: string;
  action: ActivityAction;
  resourceType: "FILE" | "FOLDER" | "SHARE";
  resourceId?: string | null;
  resourceName: string;
  details?: Record<string, unknown> | null;
}

export interface ListActivitiesInput {
  userId: string;
  page?: number;
  limit?: number;
}

export const logActivity = async ({
  userId,
  action,
  resourceType,
  resourceId,
  resourceName,
  details,
}: LogActivityInput) => {
  try {
    // If activity model is not present (e.g. in older unit test mocks), safely exit
    if (!prisma.activity?.findFirst || !prisma.activity?.create) {
      return null;
    }

    // Deduplication check: Avoid recording duplicate identical activities within 3 seconds
    const threeSecondsAgo = new Date(Date.now() - 3000);
    const recentDuplicate = await prisma.activity.findFirst({
      where: {
        userId,
        action,
        resourceType,
        resourceId: resourceId ?? null,
        createdAt: { gte: threeSecondsAgo },
      },
      select: { id: true },
    });

    if (recentDuplicate) {
      return null;
    }

    return await prisma.activity.create({
      data: {
        userId,
        action,
        resourceType,
        resourceId: resourceId ?? null,
        resourceName,
        details: details ? (details as any) : undefined,
      },
    });
  } catch (error) {
    // Activity logging should never crash the primary business operation
    console.error("Failed to log activity:", error);
    return null;
  }
};

export const listActivities = async ({
  userId,
  page = 1,
  limit = 10,
}: ListActivitiesInput) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));
  const skip = (safePage - 1) * safeLimit;

  if (!prisma.activity?.count || !prisma.activity?.findMany) {
    return {
      data: [],
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: 0,
        totalPages: 1,
      },
    };
  }

  const where = { userId };

  const [total, activities] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
  ]);

  return {
    data: activities.map((activity) => ({
      id: activity.id,
      action: activity.action,
      resourceType: activity.resourceType,
      resourceId: activity.resourceId,
      resourceName: activity.resourceName,
      details: activity.details,
      createdAt: activity.createdAt,
      user: activity.user,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
};
