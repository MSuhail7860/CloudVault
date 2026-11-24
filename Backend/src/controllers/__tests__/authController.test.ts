import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerUser: vi.fn(),
  verifyEmailAddress: vi.fn(),
}));

vi.mock("../../services/authService.js", () => ({
  loginUser: vi.fn(),
  registerUser: mocks.registerUser,
  refreshUserTokens: vi.fn(),
  logoutUser: vi.fn(),
  updateUserProfile: vi.fn(),
  changeUserPassword: vi.fn(),
  resendEmailVerification: vi.fn(),
  verifyEmailAddress: mocks.verifyEmailAddress,
}));

vi.mock("../../services/accountDeletionService.js", () => ({
  requestAccountDeletion: vi.fn(),
}));

vi.mock("../../jobs/queues.js", () => ({
  enqueueAccountDeletionJob: vi.fn(),
}));

vi.mock("../../config/database.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

import { register, verifyEmail } from "../authController.js";

const createResponse = () => {
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response;
};

describe("authController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the same registration response for new and existing addresses", async () => {
    const responses = [];
    for (const result of [{ id: "new-user" }, null]) {
      mocks.registerUser.mockResolvedValueOnce(result);
      const response = createResponse();
      await register(
        {
          body: {
            email: "person@example.com",
            password: "example-password",
          },
        } as never,
        response as never,
        vi.fn(),
      );
      responses.push({
        statusCode: response.statusCode,
        body: response.body,
      });
    }

    expect(responses[0]).toEqual(responses[1]);
    expect(responses[0]).toEqual({
      statusCode: 202,
      body: {
        success: true,
        message:
          "If the address can be registered, a verification message will be sent.",
      },
    });
  });

  it("requires a password when consuming the verification token", async () => {
    const response = createResponse();

    await verifyEmail(
      { body: { token: "A".repeat(43) } } as never,
      response as never,
      vi.fn(),
    );

    expect(response.statusCode).toBe(400);
    expect(mocks.verifyEmailAddress).not.toHaveBeenCalled();
  });
});
