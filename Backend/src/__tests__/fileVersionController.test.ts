import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../services/fileService.js", () => ({
  uploadFile: vi.fn(),
  listFiles: vi.fn(),
  getFileForDownload: vi.fn(),
  renameFile: vi.fn(),
  moveFileToTrash: vi.fn(),
  listTrashedFiles: vi.fn(),
  restoreFileFromTrash: vi.fn(),
  permanentlyDeleteFile: vi.fn(),
  uploadFileVersion: vi.fn(),
  listFileVersions: vi.fn(),
  restoreFileVersion: vi.fn(),
}));

vi.mock("../services/storageService.js", () => ({
  checkStorageConnection: vi.fn(),
  uploadObject: vi.fn(),
  downloadObject: vi.fn(),
  deleteObject: vi.fn(),
}));

import app from "../app.js";
import {
  uploadFileVersion,
  listFileVersions,
  restoreFileVersion,
} from "../services/fileService.js";
import { createAccessToken } from "../utils/jwt.js";

const uploadVersionMock = vi.mocked(uploadFileVersion);
const listVersionsMock = vi.mocked(listFileVersions);
const restoreVersionMock = vi.mocked(restoreFileVersion);

const userId = "test-user-1";
const fileId = "test-file-1";
const versionId = "test-version-1";

let token: string;

beforeEach(async () => {
  vi.resetAllMocks();
  token = await createAccessToken(userId);
});

describe("File versioning API", () => {
  describe("POST /api/v1/files/:id/versions", () => {
    it("returns 400 when no file is uploaded", async () => {
      const response = await request(app)
        .post(`/api/v1/files/${fileId}/versions`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        message: "A file is required. Use the multipart field 'file'.",
      });

      expect(uploadVersionMock).not.toHaveBeenCalled();
    });

    it("uploads a version and returns 201", async () => {
      const version = {
        id: versionId,
        fileId,
        version: 2,
        originalName: "report-v2.pdf",
        mimeType: "application/pdf",
        size: "2048",
      };

      uploadVersionMock.mockResolvedValue(version as never);

      const response = await request(app)
        .post(`/api/v1/files/${fileId}/versions`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("new file contents"), {
          filename: "report-v2.pdf",
          contentType: "application/pdf",
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        success: true,
        message: "File version uploaded successfully",
        data: version,
      });

      expect(uploadVersionMock).toHaveBeenCalledWith({
        fileId,
        ownerId: userId,
        originalName: "report-v2.pdf",
        mimeType: "application/pdf",
        buffer: expect.any(Buffer),
      });
    });
  });

  describe("GET /api/v1/files/:id/versions", () => {
    it("returns the version history", async () => {
      const versions = [
        {
          id: versionId,
          fileId,
          version: 2,
          originalName: "report-v2.pdf",
          size: "2048",
        },
        {
          id: "test-version-0",
          fileId,
          version: 1,
          originalName: "report.pdf",
          size: "1024",
        },
      ];

      listVersionsMock.mockResolvedValue(versions as never);

      const response = await request(app)
        .get(`/api/v1/files/${fileId}/versions`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: "File versions retrieved successfully",
        data: versions,
      });

      expect(listVersionsMock).toHaveBeenCalledWith({
        fileId,
        ownerId: userId,
      });
    });

    it("returns an empty array when no prior versions exist", async () => {
      listVersionsMock.mockResolvedValue([] as never);

      const response = await request(app)
        .get(`/api/v1/files/${fileId}/versions`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });

  describe("POST /api/v1/files/:id/versions/:versionId/restore", () => {
    it("restores a version and returns 200", async () => {
      const restoredFile = {
        id: fileId,
        name: "report.pdf",
        originalName: "report.pdf",
        mimeType: "application/pdf",
        size: "1024",
      };

      restoreVersionMock.mockResolvedValue(restoredFile as never);

      const response = await request(app)
        .post(
          `/api/v1/files/${fileId}/versions/${versionId}/restore`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: "File version restored successfully",
        data: restoredFile,
      });

      expect(restoreVersionMock).toHaveBeenCalledWith({
        fileId,
        versionId,
        ownerId: userId,
      });
    });
  });
});
