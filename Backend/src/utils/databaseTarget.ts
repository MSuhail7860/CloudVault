export const databaseTargetFromUrl = (connectionString: string): string => {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is invalid");
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }

  const database = decodeURIComponent(url.pathname.slice(1));
  if (!url.hostname || !database) {
    throw new Error("DATABASE_URL must include a host and database name");
  }

  return `${url.hostname}:${url.port || "5432"}/${database}`;
};

export const isDatabaseTargetConfirmed = (
  connectionString: string,
  confirmation: string | undefined,
): boolean => {
  if (!confirmation) return false;
  try {
    return databaseTargetFromUrl(connectionString) === confirmation;
  } catch {
    return false;
  }
};
