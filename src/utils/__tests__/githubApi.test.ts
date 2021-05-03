import Github from "@octokit/rest";

import {
  codeMatches,
  getFile,
  HTTP_RESPONSE_1XX,
  HTTP_RESPONSE_2XX,
  retryHttp,
  RetryParams,
} from "../githubApi";

const mockRepos = {
  getContents: jest.fn(),
};

// TODO rewrite with module mock, port github helpers from probot-release
jest.mock("@octokit/rest", () =>
  jest.fn().mockImplementation(() => ({ repos: mockRepos }))
);

describe("getFile", () => {
  const github = new Github();
  const owner = "owner";
  const repo = "repo";

  const getContents = (github.repos.getContents as unknown) as jest.Mock;

  test("loads and decodes the file", async () => {
    expect.assertions(2);
    const testContent = "test content.";

    getContents.mockReturnValue({
      data: { content: Buffer.from(testContent).toString("base64") },
    });

    const content = await getFile(
      github,
      owner,
      repo,
      "/path/to/file",
      "v1.0.0"
    );
    expect(getContents).toHaveBeenCalledWith({
      owner: "owner",
      path: "/path/to/file",
      ref: "v1.0.0",
      repo: "repo",
    });

    expect(content).toBe(testContent);
  });

  test("returns null for missing files", async () => {
    expect.assertions(1);

    getContents.mockImplementation(() => {
      const e = new Error("file not found") as any;
      e.status = 404;
      throw e;
    });

    const content = await getFile(
      github,
      owner,
      repo,
      "/path/to/missing",
      "v1.0.0"
    );
    expect(content).toBe(undefined);
  });

  test("rejects all other errors", async () => {
    expect.assertions(3);

    const errorText = "internal server error";
    getContents.mockImplementation(() => {
      const e = new Error(errorText) as any;
      e.status = 500;
      throw e;
    });

    try {
      await getFile(github, owner, repo, "/path/to/missing", "v1.0.0");
    } catch (e) {
      expect(e.message).toMatch(errorText);
      expect(e.status).toBe(500);
      expect(e.code).toBe(undefined);
    }
  });
});

describe("codeMatches", () => {
  test("accepts numerical code", () => {
    expect(codeMatches(100, [100])).toBe(true);
  });

  test("accepts text code", () => {
    expect(codeMatches(101, [HTTP_RESPONSE_1XX])).toBe(true);
  });

  test("allows single value instead of a list", () => {
    expect(codeMatches(102, HTTP_RESPONSE_1XX)).toBe(true);
  });

  test("does not accept invalid code", () => {
    expect(codeMatches(100, [200, HTTP_RESPONSE_2XX])).toBe(false);
  });
});

describe("retryHttp", () => {
  const params: Partial<RetryParams> = { cooldown: 1 };
  const errorCode = (c: number) => ({
    status: c,
  });

  // these are standing in for an async function (the type is () =>
  // Promise<T>)
  const funcReturns = async () => Promise.resolve("result");
  const funcThrows = async () => Promise.reject(errorCode(400));

  test("resolves without an error", async () => {
    await expect(retryHttp(funcReturns, params)).resolves.toBe("result");
  });

  test("resolves after one retry", async () => {
    const f = jest
      .fn()
      .mockImplementationOnce(funcThrows)
      .mockImplementationOnce(funcReturns);

    expect(
      await retryHttp(f, { ...params, retryCodes: [400], retries: 1 })
    ).toBe("result");
  });

  test("throws an error after max retries", async () => {
    expect.assertions(1);
    const f = jest
      .fn()
      .mockImplementationOnce(funcThrows)
      .mockImplementationOnce(funcThrows)
      .mockImplementationOnce(funcReturns);

    try {
      await retryHttp(f, { ...params, retryCodes: [400], retries: 1 });
      throw Error("unreachable");
    } catch (e) {
      return expect(e).toEqual(errorCode(400));
    }
  });

  test("calls the cleanup function after each retry", async () => {
    const f = jest
      .fn()
      .mockImplementationOnce(funcThrows)
      .mockImplementationOnce(funcThrows)
      .mockImplementationOnce(funcReturns);
    let cleanupCalled = 0;

    expect(
      await retryHttp(f, {
        ...params,
        cleanupFn: async () => {
          cleanupCalled += 1;
          return Promise.resolve();
        },
        retries: 2,
        retryCodes: [400],
      })
    ).toBe("result");
    expect(cleanupCalled).toBe(2);
  });

  test("throws an error if error code is not in list", async () => {
    expect.assertions(1);
    const f = jest
      .fn()
      .mockImplementationOnce(funcThrows)
      .mockImplementationOnce(funcReturns);

    try {
      await retryHttp(f, { ...params, retryCodes: [500] });
      throw Error("unreachable");
    } catch (e) {
      return expect(e).toEqual(errorCode(400));
    }
  });
});
