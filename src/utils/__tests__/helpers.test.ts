import { isDryRun } from "../helpers";

describe("isDryRun", () => {
  /**
   * Helper function to test expected isDryRun() output given a DRY_RUN value
   *
   * @param envVarValue The DRY_RUN value to test
   * @param expectedDryRunStatus The expected output of isDryRun()
   */
  function testValue(
    envVarValue: string | undefined,
    expectedDryRunStatus: boolean
  ): void {
    // undefined represents the env var not being set
    if (envVarValue !== undefined) {
      process.env.DRY_RUN = envVarValue;
    }

    expect(isDryRun()).toEqual(expectedDryRunStatus);
  }

  afterEach(() => {
    delete process.env.DRY_RUN;
  });

  test("undefined", () => testValue(undefined, false));
  test("empty string", () => testValue("", false));
  test("false", () => testValue("false", false));
  test("0", () => testValue("0", false));
  test("no", () => testValue("no", false));
  test("true", () => testValue("true", true));
  test("1", () => testValue("1", true));
  test("yes", () => testValue("yes", true));
  test("any non-empty string", () => testValue("dogs are great!", true));
}); // end describe('isDryRun')
